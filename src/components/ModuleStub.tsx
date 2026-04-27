export default function ModuleStub({ title = 'בפיתוח' }: { title?: string }) {
  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-14 pb-28">
      <div className="chapter-mark mb-4">בפיתוח</div>
      <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-4" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      <p className="text-[17px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        עמוד זה בפיתוח ויהיה זמין בקרוב.
      </p>
    </main>
  );
}
