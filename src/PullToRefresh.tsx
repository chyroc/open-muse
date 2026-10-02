import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import { t } from "../shared/i18n";
import { haptic } from "./haptics";
import "./pull-to-refresh.css";

type Refresh = () => Promise<unknown>;
const RegisterRefresh = createContext<(refresh?: Refresh) => void>(() => {});

// A page registers how it refreshes; pulling down its scroller runs it.
export function useRefreshHandler(refresh: Refresh) {
  const register = useContext(RegisterRefresh);
  useEffect(() => {
    register(refresh);
    return () => register(undefined);
  }, [register, refresh]);
}

// Pull distance, in points after resistance, that starts a refresh, and the
// offset the content keeps while the refresh runs.
const threshold = 64;
const restingOffset = 52;

// The system activity indicator: eight rounded spokes. While pulling, spokes
// appear one by one with the distance; while refreshing, they rotate.
function Spinner({
  progress,
  spinning,
}: {
  progress: number;
  spinning: boolean;
}) {
  return (
    <svg
      className={`refresh-spinner${spinning ? " spinning" : ""}`}
      width="28"
      height="28"
      viewBox="0 0 28 28"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <line
          key={index}
          x1="14"
          y1="4"
          x2="14"
          y2="9"
          strokeWidth="2.6"
          strokeLinecap="round"
          stroke="currentColor"
          transform={`rotate(${index * 45} 14 14)`}
          opacity={
            spinning
              ? 1 - index * 0.1
              : progress * 8 > index
                ? 0.35 + 0.65 * (1 - index / 8)
                : 0
          }
        />
      ))}
    </svg>
  );
}

export function PullToRefresh({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const handler = useRef<Refresh | undefined>(undefined);
  const start = useRef<number | undefined>(undefined);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const register = useCallback((refresh?: Refresh) => {
    handler.current = refresh;
  }, []);
  const onTouchStart = (event: TouchEvent) => {
    if (refreshing || !handler.current) return;
    start.current =
      (scroller.current?.scrollTop ?? 1) <= 0
        ? event.touches[0].clientY
        : undefined;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (start.current === undefined) return;
    const distance = event.touches[0].clientY - start.current;
    // The system rubber band: travel shrinks as the finger goes further.
    const range = scroller.current?.clientHeight || 600;
    const next =
      distance > 0 ? (1 - 1 / ((distance * 0.55) / range + 1)) * range : 0;
    // A light tick as the pull crosses the refresh point, either way.
    if (next >= threshold !== pull >= threshold) haptic("light");
    setPull(next);
  };
  const onTouchEnd = () => {
    const armed = pull >= threshold && handler.current;
    start.current = undefined;
    setPull(0);
    if (!armed) return;
    setRefreshing(true);
    void handler.current!().finally(() => setRefreshing(false));
  };
  const progress = Math.min(pull / threshold, 1);
  const offset = refreshing ? Math.max(pull, restingOffset) : pull;
  return (
    <RegisterRefresh.Provider value={register}>
      <div
        ref={scroller}
        className={`${className} pull-to-refresh${refreshing ? " refreshing" : ""}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="refresh-indicator"
          role={refreshing ? "status" : undefined}
          aria-label={refreshing ? t("Refreshing") : undefined}
          style={{ opacity: refreshing ? 1 : progress }}
        >
          <Spinner progress={progress} spinning={refreshing} />
        </div>
        <div
          className={`refresh-content${start.current !== undefined ? " dragging" : ""}`}
          style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        >
          {children}
        </div>
      </div>
    </RegisterRefresh.Provider>
  );
}
