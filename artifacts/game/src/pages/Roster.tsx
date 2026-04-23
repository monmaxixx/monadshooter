import { CHARACTERS } from "@/data/characters";

export default function Roster() {
  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Step 1</p>
          <h1 className="text-4xl font-bold mt-2">Character Roster</h1>
          <p className="text-zinc-400 mt-2">
            Five fighters saved and ready. This is the cast of the game.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {CHARACTERS.map((c, i) => (
            <div
              key={c.id}
              className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col items-center"
            >
              <div className="text-[10px] text-zinc-500 self-start">
                #{String(i + 1).padStart(2, "0")}
              </div>
              <div className="aspect-square w-full flex items-center justify-center my-3">
                <img
                  src={c.image}
                  alt={c.name}
                  className="max-h-full max-w-full object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.6)]"
                />
              </div>
              <div className="text-base font-semibold">{c.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
