import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FiMaximize2, FiX } from 'react-icons/fi'

type ImagePreviewProps = {
  src: string
  alt?: string
  children: ReactNode
}

/**
 * Fullscreen image preview (lightbox).
 *
 * The trigger wraps `children` (an already-rendered image) and, when clicked,
 * opens a fixed overlay with the image at up to 90vw/90vh. Closes via the X
 * button, clicking the backdrop, or pressing Escape.
 */
export function ImagePreview({ src, alt, children }: ImagePreviewProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative inline-block w-fit cursor-zoom-in text-left"
        aria-label="Open image fullscreen"
      >
        {children}
        <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <FiMaximize2 size={14} />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-full bg-zinc-900/80 p-2 text-zinc-300 transition-colors hover:text-white"
              aria-label="Close preview"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ delay: 0.05, duration: 0.15 }}
            >
              <FiX size={22} />
            </motion.button>
            <motion.img
              src={src}
              alt={alt ?? ''}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.8 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}