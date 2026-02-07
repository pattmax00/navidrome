package nativeapi

import (
	"encoding/json"
	"errors"
	"image"
	// Register image format decoders
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	// Register WebP decoder
	_ "golang.org/x/image/webp"
)

const (
	maxUploadSize     = 5 << 20 // 5 MB
	maxImageDimension = 1200
	playlistImageDir  = "playlist-images"
)

// playlistImagePath returns the filesystem path where a playlist's custom image should be stored.
// It validates that the resulting path is safely within the data folder to prevent path traversal.
func playlistImagePath(playlistID string) (string, bool) {
	p := filepath.Join(conf.Server.DataFolder, playlistImageDir, playlistID)
	p = filepath.Clean(p)
	base := filepath.Clean(filepath.Join(conf.Server.DataFolder, playlistImageDir))
	if !strings.HasPrefix(p, base+string(filepath.Separator)) {
		return "", false
	}
	return p, true
}

func uploadPlaylistImage(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		playlistID := chi.URLParam(r, "playlistId")

		// Verify the playlist exists and the user has permission to modify it
		pls, err := ds.Playlist(ctx).Get(playlistID)
		if errors.Is(err, model.ErrNotFound) {
			http.Error(w, "playlist not found", http.StatusNotFound)
			return
		}
		if err != nil {
			log.Error(ctx, "Error fetching playlist", "playlistId", playlistID, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		user, ok := request.UserFrom(ctx)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if pls.OwnerID != user.ID && !user.IsAdmin {
			http.Error(w, "you do not have permission to modify this playlist", http.StatusForbidden)
			return
		}

		// Limit request body size
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

		// Parse the multipart form
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			log.Warn(ctx, "Error parsing multipart form", err)
			http.Error(w, "file too large (max 5MB)", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("image")
		if err != nil {
			log.Warn(ctx, "Error reading uploaded file", err)
			http.Error(w, "missing or invalid image file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Validate the file is an image by attempting to decode it
		img, format, err := image.Decode(file)
		if err != nil {
			log.Warn(ctx, "Uploaded file is not a valid image", "filename", header.Filename, err)
			http.Error(w, "invalid image file", http.StatusBadRequest)
			return
		}
		log.Debug(ctx, "Received playlist image upload", "playlistId", playlistID, "filename", header.Filename, "format", format, "size", header.Size)

		// Resize if necessary (cap at maxImageDimension x maxImageDimension, preserving aspect ratio)
		bounds := img.Bounds()
		if bounds.Dx() > maxImageDimension || bounds.Dy() > maxImageDimension {
			img = imaging.Fit(img, maxImageDimension, maxImageDimension, imaging.Lanczos)
		}

		// Ensure the storage directory path is safe
		dir, safe := playlistImagePath(playlistID)
		if !safe {
			log.Error(ctx, "Invalid playlist image path", "playlistId", playlistID)
			http.Error(w, "invalid playlist id", http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Error(ctx, "Error creating playlist image directory", "dir", dir, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Save as JPEG for consistent format and smaller file size
		destPath := filepath.Join(dir, "cover.jpg")
		if err := imaging.Save(img, destPath, imaging.JPEGQuality(conf.Server.CoverJpegQuality)); err != nil {
			log.Error(ctx, "Error saving playlist image", "path", destPath, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Update the playlist record with the image path. Put() bumps UpdatedAt automatically.
		pls.ImagePath = destPath
		if err := ds.Playlist(ctx).Put(pls); err != nil {
			log.Error(ctx, "Error updating playlist with image path", "playlistId", playlistID, err)
			// Try to clean up the saved file
			_ = os.Remove(destPath)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Custom playlist image uploaded", "playlistId", playlistID, "path", destPath)

		resp, err := json.Marshal(struct {
			ID string `json:"id"`
		}{ID: playlistID})
		if err != nil {
			log.Error(ctx, "Error marshalling response", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}
}

func deletePlaylistImage(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		playlistID := chi.URLParam(r, "playlistId")

		// Verify the playlist exists and the user has permission
		pls, err := ds.Playlist(ctx).Get(playlistID)
		if errors.Is(err, model.ErrNotFound) {
			http.Error(w, "playlist not found", http.StatusNotFound)
			return
		}
		if err != nil {
			log.Error(ctx, "Error fetching playlist", "playlistId", playlistID, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		user, ok := request.UserFrom(ctx)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if pls.OwnerID != user.ID && !user.IsAdmin {
			http.Error(w, "you do not have permission to modify this playlist", http.StatusForbidden)
			return
		}

		if pls.ImagePath == "" {
			http.Error(w, "playlist has no custom image", http.StatusNotFound)
			return
		}

		// Remove the image file and directory, validating the path first
		dir, safe := playlistImagePath(playlistID)
		if safe {
			if err := os.RemoveAll(dir); err != nil {
				log.Error(ctx, "Error removing playlist image directory", "dir", dir, err)
				// Continue anyway to clear the DB reference
			}
		}

		// Clear the image path in the playlist record. Put() bumps UpdatedAt automatically.
		pls.ImagePath = ""
		if err := ds.Playlist(ctx).Put(pls); err != nil {
			log.Error(ctx, "Error clearing playlist image path", "playlistId", playlistID, err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Custom playlist image removed", "playlistId", playlistID)

		resp, err := json.Marshal(struct {
			ID string `json:"id"`
		}{ID: playlistID})
		if err != nil {
			log.Error(ctx, "Error marshalling response", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(resp)
	}
}
