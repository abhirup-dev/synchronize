import { Link } from "@tanstack/react-router";

/**
 * An address that resolved to nothing. Usually a link minted against a different
 * runtime — the address is well-formed, just not present here. Saying so is the
 * payoff for opaque ids: the alternative was silently opening whichever room
 * happened to sit at the same autoincrement position.
 */
export function AddressNotFound() {
  return (
    <div className="min-h-0 h-full grid place-items-center bg-paper text-ink">
      <div className="max-w-[520px] [border:var(--line-bold)] shadow-lg bg-paper-2 p-[var(--space-24)]">
        <div className="brand-mark">S</div>
        <h1 className="mt-[16px] mb-[8px] font-display text-[length:var(--text-24)]">Not found here</h1>
        <p className="mt-[8px] font-ui leading-[1.45]">
          Nothing at <code>{window.location.pathname}</code> on this daemon. Links are runtime-specific, so one created
          against a different daemon will not resolve here.
        </p>
        <p className="mt-[12px] font-ui">
          <Link to="/">Back to the first room</Link>
        </p>
      </div>
    </div>
  );
}
