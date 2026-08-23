import {
  BoundaryExploreLink,
  BoundaryHomeLink,
  BoundaryPanel,
} from "./boundary-panel";

export default function NotFound() {
  return (
    <BoundaryPanel
      eyebrow="404"
      title="Page not found."
      body="The page you requested does not exist or is no longer available. Check the address, or pick up where you left off."
      actions={
        <>
          <BoundaryHomeLink />
          <BoundaryExploreLink />
        </>
      }
    />
  );
}
