export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  await params; // token is a bearer credential: never log or render it
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-xl font-semibold">Prepaid dinner + show bundle</h1>
      <p className="mt-2 text-neutral-600">Payment page placeholder.</p>
    </main>
  );
}
