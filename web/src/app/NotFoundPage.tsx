import { Link } from "./Link.tsx";

export const NotFoundPage = () => (
  <div className="mx-auto flex max-w-2xl flex-col gap-3 py-12">
    <h1 className="text-title font-semibold tracking-[-0.01em]">Page not found</h1>
    <p className="text-body">
      There's nothing at this address. <Link to="/">Go to your pull requests</Link>.
    </p>
  </div>
);
