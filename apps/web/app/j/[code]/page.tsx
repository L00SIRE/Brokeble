export default async function JoinPage({ params }: PageProps<"/j/[code]">) {
  const { code } = await params;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="text-balance text-(length:--text-title) font-semibold">Join plan {code}</h1>
      <p className="text-muted">Placeholder. The join form (POST /join) lands here.</p>
    </main>
  );
}
