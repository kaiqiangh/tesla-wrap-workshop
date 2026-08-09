import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="WrapForge home">
      <span className="brand-mark" aria-hidden="true">
        W
      </span>
      <span>WRAPFORGE</span>
    </Link>
  );
}
