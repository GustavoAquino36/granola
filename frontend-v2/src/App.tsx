import { cn } from '@/lib/utils'

const swatches = [
  { name: 'purple.dark', hex: '#2D0A31', onDark: true },
  { name: 'purple.mid', hex: '#4A1942', onDark: true },
  { name: 'purple.accent', hex: '#7B2D6E', onDark: true },
  { name: 'purple.light', hex: '#9B4D8B', onDark: true },
  { name: 'gold', hex: '#C9A96E', onDark: false },
  { name: 'gold.light', hex: '#D4BC8A', onDark: false },
  { name: 'neutral.off', hex: '#F8F6F4', onDark: false },
  { name: 'neutral.gray', hex: '#9A9590', onDark: false },
  { name: 'neutral.text', hex: '#3D3A38', onDark: true },
  { name: 'neutral.dark', hex: '#1A1A1A', onDark: true },
]

function Swatch({ name, hex, onDark }: { name: string; hex: string; onDark: boolean }) {
  return (
    <div
      className={cn(
        'group relative flex h-28 flex-col justify-end rounded-card p-3 shadow-valerius-soft',
        'transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:-translate-y-0.5 hover:shadow-valerius-raised',
        'border border-black/5',
      )}
      style={{ backgroundColor: hex }}
    >
      <span
        className={cn(
          'text-xs font-medium tracking-tight',
          onDark ? 'text-white/90' : 'text-valerius-dark/80',
        )}
      >
        {name}
      </span>
      <span
        className={cn(
          'tabular-nums text-[10px] uppercase tracking-wider',
          onDark ? 'text-white/60' : 'text-valerius-dark/50',
        )}
      >
        {hex}
      </span>
    </div>
  )
}

function ProcessoDemoCard() {
  return (
    <div
      className={cn(
        'group rounded-card border border-black/5 bg-white p-6 shadow-valerius-soft',
        'transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:-translate-y-0.5 hover:border-valerius-gold/60 hover:shadow-valerius-raised',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-valerius-gray">
            Processo · Trabalhista
          </p>
          <h3 className="font-display mt-1 text-2xl font-medium leading-tight text-valerius-text">
            Fulano de Tal vs. Empresa S.A.
          </h3>
          <p className="tabular-nums mt-2 text-sm text-valerius-gray">
            1234567-89.2024.8.26.0001
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full bg-valerius-gold/15 px-2.5 py-1',
            'text-xs font-medium text-valerius-purple-dark',
          )}
        >
          Em andamento
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-black/5 pt-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-valerius-gray">
            Valor da causa
          </p>
          <p className="tabular-nums mt-0.5 text-lg font-semibold text-valerius-text">
            R$ 128.450,00
          </p>
        </div>
        <button
          className={cn(
            'rounded-control bg-valerius-gold px-4 py-2 text-sm font-medium text-valerius-dark',
            'transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            'hover:-translate-y-0.5 hover:bg-valerius-gold-light hover:shadow-valerius-raised',
            'active:translate-y-0',
          )}
        >
          Abrir autos
        </button>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-valerius-off">
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-valerius-purple-dark px-8 py-24">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 40%, #C9A96E 0%, transparent 45%), radial-gradient(circle at 70% 60%, #9B4D8B 0%, transparent 50%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center text-center">
          <p className="mb-6 text-xs font-medium uppercase tracking-[0.4em] text-valerius-gold/70">
            Smoke Test · Fase 0
          </p>
          <h1 className="font-display text-5xl font-medium leading-[1.05] text-valerius-gold sm:text-7xl">
            Um produto Valerius
          </h1>
          <p className="mt-6 max-w-xl text-balance text-sm leading-relaxed text-white/70 sm:text-base">
            Fontes carregadas, paleta aplicada, proxy configurado, tokens no CSS.
            Frontend-v2 em pé.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-8 py-20">
        <div className="mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-valerius-gray">
            01 · Identidade
          </p>
          <h2 className="font-display mt-2 text-4xl font-medium text-valerius-text">
            Paleta Valerius
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-8 pb-24">
        <div className="mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-valerius-gray">
            02 · Componente exemplo
          </p>
          <h2 className="font-display mt-2 text-4xl font-medium text-valerius-text">
            Card · com micro-animação
          </h2>
          <p className="mt-2 max-w-xl text-sm text-valerius-gray">
            Passe o mouse pra ver o lift, a borda dourada e a elevação da sombra.
            Tabular-nums no valor e no CNJ.
          </p>
        </div>
        <ProcessoDemoCard />
      </section>

      <footer className="border-t border-black/5 px-8 py-8 text-center">
        <p className="text-xs text-valerius-gray">
          Granola · frontend-v2 · Fase 0 smoke test
        </p>
      </footer>
    </div>
  )
}
