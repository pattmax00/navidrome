import {
  Card,
  CardContent,
  CardMedia,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import PhotoCameraIcon from '@material-ui/icons/PhotoCamera'
import DeleteIcon from '@material-ui/icons/Delete'
import {
  useTranslate,
  useNotify,
  useRefresh,
  useDataProvider,
} from 'react-admin'
import { useCallback, useRef, useState, useEffect } from 'react'
import Lightbox from 'react-image-lightbox'
import 'react-image-lightbox/style.css'
import {
  CollapsibleComment,
  DurationField,
  SizeField,
  isWritable,
} from '../common'
import subsonic from '../subsonic'

const useStyles = makeStyles(
  (theme) => ({
    root: {
      [theme.breakpoints.down('xs')]: {
        padding: '0.7em',
        minWidth: '20em',
      },
      [theme.breakpoints.up('sm')]: {
        padding: '1em',
        minWidth: '32em',
      },
    },
    cardContents: {
      display: 'flex',
    },
    details: {
      display: 'flex',
      flexDirection: 'column',
    },
    content: {
      flex: '2 0 auto',
    },
    coverParent: {
      [theme.breakpoints.down('xs')]: {
        height: '8em',
        width: '8em',
        minWidth: '8em',
      },
      [theme.breakpoints.up('sm')]: {
        height: '10em',
        width: '10em',
        minWidth: '10em',
      },
      [theme.breakpoints.up('lg')]: {
        height: '15em',
        width: '15em',
        minWidth: '15em',
      },
      backgroundColor: 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    cover: {
      objectFit: 'contain',
      cursor: 'pointer',
      display: 'block',
      width: '100%',
      height: '100%',
      backgroundColor: 'transparent',
      transition: 'opacity 0.3s ease-in-out',
    },
    coverLoading: {
      opacity: 0.5,
    },
    imageActions: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      display: 'flex',
      gap: 2,
      opacity: 0,
      transition: 'opacity 0.2s ease-in-out',
      '$coverParent:hover &': {
        opacity: 1,
      },
    },
    imageActionButton: {
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      color: '#fff',
      padding: 6,
      '&:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
      },
    },
    imageActionIcon: {
      fontSize: '1.1rem',
    },
    title: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      wordBreak: 'break-word',
    },
    stats: {
      marginTop: '1em',
      marginBottom: '0.5em',
    },
  }),
  {
    name: 'NDPlaylistDetails',
  },
)

const PlaylistDetails = (props) => {
  const { record = {} } = props
  const translate = useTranslate()
  const notify = useNotify()
  const refresh = useRefresh()
  const dataProvider = useDataProvider()
  const classes = useStyles()
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('lg'))
  const [isLightboxOpen, setLightboxOpen] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const imageUrl = subsonic.getCoverArtUrl(record, 300, true)
  const fullImageUrl = subsonic.getCoverArtUrl(record)

  const writable = isWritable(record.ownerId)

  // Reset image state when playlist changes
  useEffect(() => {
    setImageLoading(true)
    setImageError(false)
  }, [record.id])

  const handleImageLoad = useCallback(() => {
    setImageLoading(false)
    setImageError(false)
  }, [])

  const handleImageError = useCallback(() => {
    setImageLoading(false)
    setImageError(true)
  }, [])

  const handleOpenLightbox = useCallback(() => {
    if (!imageError) {
      setLightboxOpen(true)
    }
  }, [imageError])

  const handleCloseLightbox = useCallback(() => setLightboxOpen(false), [])

  const handleUploadClick = useCallback((e) => {
    e.stopPropagation()
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [])

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      if (!file || !record.id) return

      // Validate file type client-side
      if (!file.type.startsWith('image/')) {
        notify(
          translate('resources.playlist.message.invalidImageType'),
          'warning',
        )
        return
      }

      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        notify(
          translate('resources.playlist.message.imageTooLarge'),
          'warning',
        )
        return
      }

      setUploading(true)
      try {
        await dataProvider.uploadPlaylistImage(record.id, file)
        notify('ra.notification.updated', 'info', { smart_count: 1 })
        refresh()
      } catch (err) {
        notify(
          err.message ||
            translate('resources.playlist.message.imageUploadError'),
          'warning',
        )
      } finally {
        setUploading(false)
        // Reset file input so the same file can be re-selected
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [record.id, dataProvider, notify, refresh, translate],
  )

  const handleRemoveImage = useCallback(
    async (e) => {
      e.stopPropagation()
      if (!record.id || !record.imagePath) return

      try {
        await dataProvider.deletePlaylistImage(record.id)
        notify('ra.notification.updated', 'info', { smart_count: 1 })
        refresh()
      } catch (err) {
        notify(
          err.message ||
            translate('resources.playlist.message.imageRemoveError'),
          'warning',
        )
      }
    },
    [record.id, record.imagePath, dataProvider, notify, refresh, translate],
  )

  return (
    <Card className={classes.root}>
      <div className={classes.cardContents}>
        <div className={classes.coverParent}>
          <CardMedia
            key={record.id} // Force re-render when playlist changes
            component={'img'}
            src={imageUrl}
            width="400"
            height="400"
            className={`${classes.cover} ${imageLoading || uploading ? classes.coverLoading : ''}`}
            onClick={handleOpenLightbox}
            onLoad={handleImageLoad}
            onError={handleImageError}
            title={record.name}
            style={{
              cursor: imageError ? 'default' : 'pointer',
            }}
          />
          {writable && (
            <div className={classes.imageActions}>
              <Tooltip
                title={translate(
                  'resources.playlist.actions.uploadImage',
                )}
              >
                <IconButton
                  className={classes.imageActionButton}
                  onClick={handleUploadClick}
                  size="small"
                  disabled={uploading}
                >
                  <PhotoCameraIcon className={classes.imageActionIcon} />
                </IconButton>
              </Tooltip>
              {record.imagePath && (
                <Tooltip
                  title={translate(
                    'resources.playlist.actions.removeImage',
                  )}
                >
                  <IconButton
                    className={classes.imageActionButton}
                    onClick={handleRemoveImage}
                    size="small"
                  >
                    <DeleteIcon className={classes.imageActionIcon} />
                  </IconButton>
                </Tooltip>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          )}
        </div>
        <div className={classes.details}>
          <CardContent className={classes.content}>
            <Typography
              variant={isDesktop ? 'h5' : 'h6'}
              className={classes.title}
            >
              {record.name || translate('ra.page.loading')}
            </Typography>
            <Typography component="p" className={classes.stats}>
              {record.songCount ? (
                <span>
                  {record.songCount}{' '}
                  {translate('resources.song.name', {
                    smart_count: record.songCount,
                  })}
                  {' · '}
                  <DurationField record={record} source={'duration'} />
                  {' · '}
                  <SizeField record={record} source={'size'} />
                </span>
              ) : (
                <span>&nbsp;</span>
              )}
            </Typography>
            <CollapsibleComment record={record} />
          </CardContent>
        </div>
      </div>
      {isLightboxOpen && !imageError && (
        <Lightbox
          imagePadding={50}
          animationDuration={200}
          imageTitle={record.name}
          mainSrc={fullImageUrl}
          onCloseRequest={handleCloseLightbox}
        />
      )}
    </Card>
  )
}

export default PlaylistDetails
