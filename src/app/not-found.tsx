import Link from "next/link";

export default function NotFound() {
  return (
    <div className="w-full max-w-xl mx-auto px-4 py-16 flex flex-col items-center text-center gap-4">
      <div className="card p-6 flex flex-col items-center gap-3 w-full">
        <h1 className="text-[20px] font-extrabold">Nothing here</h1>
        <p className="text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          That page doesn&apos;t exist. It may have been a link to something that has since been deleted.
        </p>
        <Link href="/" className="btn btn-primary mt-1">
          Go home
        </Link>
      </div>
    </div>
  );
}
