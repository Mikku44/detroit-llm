import { useState } from 'react'
import { cn } from '@/lib/utils'
import { DottedGlowBackground } from './ui/dotted-glow-background'
import { ImagePreview } from './ImagePreview'

type GlowImageProps = React.ImgHTMLAttributes<HTMLImageElement>

const loadState = new Map<string, 'loaded' | 'failed'>()

/**
 * Image loader for generated images.
 *
 * While the image is downloading it renders the DottedGlowBackground shimmer
 * behind a reserved placeholder box. Once loaded the container shrink-wraps to
 * the image's real size and the glow stays behind it, fading out over ~700ms
 * so the dots are always the same size as the image. On a load error it swaps
 * in a quiet fallback tile instead of a broken image icon.
 *
 * The load result is cached per URL so that re-mounts (e.g. markdown
 * re-rendering on every keystroke or during streaming) never re-show the
 * placeholder or re-fetch the image.
 */
export function GlowImage({ className, src, alt, ...props }: GlowImageProps) {
  const url = src ?? ''
  const [loaded, setLoaded] = useState(() => loadState.get(url) === 'loaded')
  const [failed, setFailed] = useState(() => loadState.get(url) === 'failed')
  const [glowVisible, setGlowVisible] = useState(() => !loadState.has(url))

  const handleLoad = () => {
    if (url) loadState.set(url, 'loaded')
    setLoaded(true)
    window.setTimeout(() => setGlowVisible(false), 900)
  }

  const handleError = () => {
    if (url) loadState.set(url, 'failed')
    setFailed(true)
  }

  return (
    <div
      className={cn(
        'relative my-3 overflow-hidden rounded-xl border',
        loaded
          ? 'w-fit border-zinc-800 bg-transparent'
          : 'aspect-video w-full border-zinc-800/70 bg-zinc-900/60',
      )}
    >
      {!failed && glowVisible && (
        <DottedGlowBackground
          className={cn(
            'pointer-events-none transition-opacity duration-700',
            loaded && 'opacity-0',
          )}
          opacity={0.55}
          gap={16}
          radius={3}
          color="rgba(228,228,231,0.9)"
          glowColor="rgba(255,255,255,0.9)"
          darkColor="rgba(228,228,231,0.9)"
          darkGlowColor="rgba(255,255,255,0.9)"
          speedMin={0.4}
          speedMax={1.4}
          speedScale={1}
        />
      )}

      {failed ? (
        <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
          Couldn&apos;t load image
        </div>
      ) : loaded ? (
        <ImagePreview src={src ?? ''} alt={alt}>
          <img
            src={src}
            alt={alt ?? ''}
            onError={handleError}
            className={cn('block max-h-[420px] max-w-full object-cover', className)}
            {...props}
          />
        </ImagePreview>
      ) : (
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          className="h-full w-full opacity-0"
          onLoad={handleLoad}
          onError={handleError}
          {...props}
        />
      )}
    </div>
  )
}