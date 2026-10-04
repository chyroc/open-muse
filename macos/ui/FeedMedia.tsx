import { t } from "../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { InspirationItem } from "../../shared/inspiration";
import { CloseIcon } from "./icons";

type Picture = NonNullable<InspirationItem["images"]>[number];

// The tallest a single picture under a post is drawn, and the shape assumed
// until it has loaded.
const heroHeight = 170;
const fallbackRatio = 16 / 9;

// A picture opened over the whole window: it fades and scales up, and closes
// with Escape, a click anywhere, or the close button.
function FeedImageViewer({
  picture,
  onClose,
}: {
  picture: Picture;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal?.();
    return () => {
      element.close?.();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="feed-viewer"
      aria-label={t("Post image")}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={() => close.current()}
    >
      <img src={picture.url} alt={picture.alt} referrerPolicy="no-referrer" />
      <button
        className="feed-viewer-close"
        aria-label={t("Close")}
        onClick={(event) => {
          event.stopPropagation();
          close.current();
        }}
      >
        <CloseIcon />
      </button>
    </dialog>
  );
}

// One picture, shown up to the hero height at its own shape. It pulses while
// loading and is dropped if it fails.
function HeroPicture({
  picture,
  onOpen,
  onFail,
}: {
  picture: Picture;
  onOpen: () => void;
  onFail: () => void;
}) {
  const [ratio, setRatio] = useState<number>();
  const shown = ratio ?? fallbackRatio;
  return (
    <div
      className={`feed-hero ${ratio ? "" : "loading"}`}
      style={{
        aspectRatio: String(shown),
        width: `min(100%, ${Math.round(heroHeight * shown)}px)`,
      }}
    >
      <button
        type="button"
        aria-label={t("Show the full image")}
        onClick={onOpen}
      >
        <img
          src={picture.url}
          alt={picture.alt || t("Post image")}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0)
              setRatio(naturalWidth / naturalHeight);
          }}
          onError={onFail}
        />
      </button>
    </div>
  );
}

function RailPicture({
  picture,
  onOpen,
  onFail,
}: {
  picture: Picture;
  onOpen: () => void;
  onFail: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      className={`feed-rail-item ${loaded ? "" : "loading"}`}
      aria-label={t("Show the full image")}
      onClick={onOpen}
    >
      <img
        src={picture.url}
        alt={picture.alt || t("Post image")}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={onFail}
      />
    </button>
  );
}

// A post's pictures: one is drawn large, several sit in a row of squares that
// scrolls sideways.
export function FeedMedia({ item }: { item: InspirationItem }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [open, setOpen] = useState<Picture>();
  const pictures = (item.images ?? []).filter(
    (picture) => !failed.includes(picture.url),
  );
  if (!pictures.length) return null;
  const fail = (picture: Picture) => () =>
    setFailed((current) => [...current, picture.url]);
  return (
    <div className="feed-media">
      {pictures.length === 1 ? (
        <HeroPicture
          picture={pictures[0]}
          onOpen={() => setOpen(pictures[0])}
          onFail={fail(pictures[0])}
        />
      ) : (
        <div className="feed-rail">
          {pictures.map((picture) => (
            <RailPicture
              key={picture.url}
              picture={picture}
              onOpen={() => setOpen(picture)}
              onFail={fail(picture)}
            />
          ))}
        </div>
      )}
      {open && (
        <FeedImageViewer picture={open} onClose={() => setOpen(undefined)} />
      )}
    </div>
  );
}
