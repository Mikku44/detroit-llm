import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

function NotFoundIllustration() {
  return (
    <svg
      width="200"
      height="120"
      viewBox="0 0 200 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M30 60 L68 60"
        className="stroke-white/20"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <polygon points="66,56 74,60 66,64" className="fill-white/20" />
      <rect
        x="76"
        y="42"
        width="56"
        height="36"
        rx="18"
        className="stroke-[oklch(0.511_0.262_276.966)]/60 fill-[oklch(0.511_0.262_276.966)]/15"
        strokeWidth="2"
      />
      <circle cx="94" cy="60" r="12" className="fill-[oklch(0.511_0.262_276.966)]/30" />
      <circle cx="94" cy="60" r="6" className="fill-[oklch(0.511_0.262_276.966)]" />
      <path
        d="M134 60 Q150 60 158 48"
        className="stroke-white/20"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="162" cy="44" r="3" className="fill-white/15" />
      <path
        d="M134 60 Q150 60 158 72"
        className="stroke-white/20"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="162" cy="76" r="3" className="fill-white/15" />
      <circle cx="22" cy="60" r="2" className="fill-white/15" />
      <circle cx="174" cy="44" r="2" className="fill-white/10" />
      <circle cx="174" cy="76" r="2" className="fill-white/10" />
    </svg>
  )
}

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center bg-transparent p-4 md:min-h-[calc(100vh-8rem)]">
      <Empty className=" py-12">
        <EmptyHeader>
          <EmptyMedia>
            <NotFoundIllustration />
          </EmptyMedia>
          <EmptyTitle className="text-white">404 - Page not found</EmptyTitle>
          <EmptyDescription className="text-zinc-400">
            This page went off the grid. The link may be broken or the page has moved.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button
              onClick={() => navigate(-1)}
              variant="outline"
              className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 hover:text-white"
            >
              Go back
            </Button>
            <Button
              onClick={() => navigate("/")}
              className="bg-[oklch(0.511_0.262_276.966)] text-white hover:bg-[oklch(0.44_0.22_276.966)]"
            >
              Back to home
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}
