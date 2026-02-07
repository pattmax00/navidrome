package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddMigrationContext(upAddPlaylistImagePath, downAddPlaylistImagePath)
}

func upAddPlaylistImagePath(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `alter table playlist add column image_path varchar default '' not null;`)
	return err
}

func downAddPlaylistImagePath(_ context.Context, tx *sql.Tx) error {
	_, err := tx.Exec(`alter table playlist drop column image_path;`)
	return err
}
