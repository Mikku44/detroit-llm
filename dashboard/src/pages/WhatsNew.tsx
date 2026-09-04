import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { whatsNewItems } from '../components/WhatsNew'

export default function WhatsNew() {
  return (
    <div className="p-8 text-zinc-100 font-sans space-y-10">
      <div className="max-w-6xl w-full mx-auto">
        <span className="text-sm font-medium text-zinc-500 tracking-wide">Changelog</span>
        <h1 className="text-4xl lg:text-5xl font-serif leading-tight font-normal text-zinc-50 mt-2 flex items-center gap-3">
          <Sparkles size={32} className="text-(--primary-color) shrink-0" />
          What&apos;s New
        </h1>
        <p className="text-zinc-400 text-base max-w-2xl leading-relaxed mt-3">
          Latest features, models and improvements — newest first.
        </p>
      </div>

      <div className="max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
        {whatsNewItems.map((item) => {
          return (
            <article
              key={item.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden hover:border-zinc-700 transition-colors"
            >
              <div className="relative h-48 bg-zinc-800 overflow-hidden">
                <img
                  src={item.image}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/60 to-transparent" />
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span className="rounded-full bg-(--primary-color) px-2.5 py-1 text-[10px] font-bold tracking-widest text-white">
                    {item.tag}
                  </span>
                  <span className="rounded-full bg-zinc-900/80 backdrop-blur px-2 py-1 text-[10px] font-medium text-zinc-300 border border-zinc-700/50">
                    {item.date}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <h2 className="text-base text-zinc-100 leading-tight">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.description}</p>
                {item.href && (
                  <Link
                    to={item.href}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-(--primary-color) hover:underline"
                  >
                    Learn more <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
