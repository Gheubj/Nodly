import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ModelType, TrainingEpochLog } from "@/shared/types/ai";

type StudioTrainingProcessVizProps = {
  modelType: ModelType;
  epochHistory: TrainingEpochLog[];
  warming: boolean;
  compact?: boolean;
};

function pickLoss(r: TrainingEpochLog): number | undefined {
  const v = r.loss ?? r.valLoss ?? r.mse ?? r.valMse;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.min(1, Math.max(0, x));
}

function useTrainingVizMetrics(history: TrainingEpochLog[]) {
  return useMemo(() => {
    const losses = history.map(pickLoss).filter((v): v is number => v !== undefined);
    const last = losses.length ? losses[losses.length - 1]! : null;
    const prev = losses.length > 1 ? losses[losses.length - 2]! : null;
    let lossNorm = 0.5;
    if (last != null && losses.length >= 1) {
      const minL = Math.min(...losses);
      const maxL = Math.max(...losses);
      const span = Math.max(maxL - minL, 1e-9);
      lossNorm = clamp01((last - minL) / span);
    }
    let improve = 0;
    if (prev != null && last != null && prev > 0) {
      improve = clamp01((prev - last) / (prev + 1e-9));
    }
    const dashSec = Math.min(2.2, Math.max(0.55, 0.85 + 1.15 * lossNorm - 0.5 * improve));
    const edgeW = 1.15 + 2.35 * lossNorm;

    const lastRow = history.length ? history[history.length - 1]! : null;
    const accRaw =
      lastRow?.valAccuracy ?? lastRow?.accuracy ?? undefined;
    const acc01 = typeof accRaw === "number" && Number.isFinite(accRaw) ? clamp01(accRaw) : null;

    const slice = history.slice(-56);
    const pts: { x: number; y: number }[] = [];
    const sliceLosses: number[] = [];
    for (const r of slice) {
      const L = pickLoss(r);
      if (L !== undefined) {
        sliceLosses.push(L);
      }
    }
    if (sliceLosses.length >= 2) {
      const minL = Math.min(...sliceLosses);
      const maxL = Math.max(...sliceLosses);
      const span = Math.max(maxL - minL, 1e-9);
      const n = sliceLosses.length;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        const L = sliceLosses[i]!;
        const ty = (L - minL) / span;
        pts.push({ x: t, y: ty });
      }
    }

    return { lossNorm, dashSec, edgeW, acc01, pts, improve };
  }, [history]);
}

function Node({
  cx,
  cy,
  r,
  className,
  style
}: {
  cx: number;
  cy: number;
  r: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      className={["studio-training-viz__node", className ?? ""].filter(Boolean).join(" ")}
      style={style}
    />
  );
}

function Edge({
  x1,
  y1,
  x2,
  y2,
  dashClass,
  strokeWidth
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashClass: string;
  strokeWidth: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={`studio-training-viz__edge ${dashClass}`}
      strokeLinecap="round"
      strokeWidth={strokeWidth}
    />
  );
}

function fanEdges(
  fromXs: number[],
  fromYs: number[],
  toXs: number[],
  toYs: number[],
  dashBase: number,
  strokeWidth: number
) {
  const lines: ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < fromXs.length; i++) {
    for (let j = 0; j < toXs.length; j++) {
      lines.push(
        <Edge
          key={`${i}-${j}`}
          x1={fromXs[i]!}
          y1={fromYs[i]!}
          x2={toXs[j]!}
          y2={toYs[j]!}
          dashClass={`studio-training-viz__dash--${(dashBase + k++) % 4}`}
          strokeWidth={strokeWidth}
        />
      );
    }
  }
  return lines;
}

function positionsColumn(cx: number, top: number, bottom: number, count: number): { x: number; y: number }[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [{ x: cx, y: (top + bottom) / 2 }];
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push({ x: cx, y: top + t * (bottom - top) });
  }
  return out;
}

function sparklineFromPts(
  pts: { x: number; y: number }[],
  x0: number,
  x1: number,
  y0: number,
  y1: number
): { line: string; area: string } | null {
  if (pts.length < 2) {
    return null;
  }
  const coords = pts.map((p) => {
    const x = x0 + p.x * (x1 - x0);
    const y = y0 + p.y * (y1 - y0);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(" ");
  const first = `${x0.toFixed(1)},${y1.toFixed(1)}`;
  const last = `${x1.toFixed(1)},${y1.toFixed(1)}`;
  const area = `${first} ${line} ${last} Z`;
  return { line, area };
}

export function StudioTrainingProcessViz({ modelType, epochHistory, warming, compact }: StudioTrainingProcessVizProps) {
  const { lossNorm, dashSec, edgeW, acc01, pts } = useTrainingVizMetrics(epochHistory);
  const sparkFillId = useId().replace(/:/g, "");
  const prevLen = useRef(0);
  const [epochTick, setEpochTick] = useState(false);

  useEffect(() => {
    const n = epochHistory.length;
    if (n > prevLen.current && n > 0) {
      setEpochTick(true);
      const t = window.setTimeout(() => setEpochTick(false), 480);
      prevLen.current = n;
      return () => window.clearTimeout(t);
    }
    prevLen.current = n;
  }, [epochHistory.length]);

  const vb = compact ? "0 0 300 102" : "0 0 340 122";
  const top = compact ? 22 : 26;
  const bottom = compact ? 62 : 74;
  const sparkY0 = compact ? 72 : 84;
  const sparkY1 = compact ? 92 : 106;
  const sparkX0 = compact ? 18 : 22;
  const sparkX1 = compact ? 282 : 318;
  const laneTitle = compact ? "Примеры → модель → ответ" : "Строки таблицы → счёт в модели → ответ";
  const sparkCaption = compact ? "Тот же loss, что на графике ниже" : "Ошибка по эпохам — как на первом графике ниже";
  const cxTitle = compact ? 150 : 170;
  const cxSparkCap = compact ? 150 : 170;
  const yTitle = compact ? 13 : 14;
  const ySparkCap = compact ? 99 : 118;

  const spark = useMemo(
    () => sparklineFromPts(pts, sparkX0, sparkX1, sparkY0, sparkY1),
    [pts, sparkX0, sparkX1, sparkY0, sparkY1]
  );

  const rIn = compact ? 4 : 5;
  const rMid = compact ? 4.5 : 5.5;
  const rOutBase = compact ? 5 : 6;
  const rOut =
    acc01 != null ? rOutBase * (0.88 + 0.28 * acc01) : rOutBase * (0.92 + 0.2 * (1 - lossNorm * 0.35));

  const xIn = compact ? 22 : 26;
  const inCount = 3;
  const inPos = positionsColumn(xIn, top, bottom, inCount);

  const rootClass = [
    "studio-training-viz",
    warming ? "studio-training-viz--warming" : "",
    compact ? "studio-training-viz--compact" : "",
    epochTick ? "studio-training-viz--epoch-tick" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const rootStyle = {
    "--stv-loss-n": String(lossNorm),
    "--stv-dash-s": `${dashSec}s`
  } as CSSProperties;

  let body: ReactNode;

  if (modelType === "tabular_regression") {
    const xH = compact ? 118 : 132;
    const xO = compact ? 268 : 300;
    const hPos = positionsColumn(xH, top, bottom, 1);
    const oPos = positionsColumn(xO, top, bottom, 1);
    body = (
      <>
        {inPos.map((p, i) => (
          <Node key={`in-${i}`} cx={p.x} cy={p.y} r={rIn} className={`studio-training-viz__node--p${i % 5}`} />
        ))}
        <Node cx={hPos[0]!.x} cy={hPos[0]!.y} r={rMid} className="studio-training-viz__node--p3" />
        <Node cx={oPos[0]!.x} cy={oPos[0]!.y} r={rOut} className="studio-training-viz__node--out studio-training-viz__node--p0" />
        {fanEdges(
          inPos.map((p) => p.x),
          inPos.map((p) => p.y),
          [hPos[0]!.x],
          [hPos[0]!.y],
          0,
          edgeW
        )}
        <Edge
          x1={hPos[0]!.x}
          y1={hPos[0]!.y}
          x2={oPos[0]!.x}
          y2={oPos[0]!.y}
          dashClass="studio-training-viz__dash--2"
          strokeWidth={edgeW * 1.05}
        />
      </>
    );
  } else if (modelType === "tabular_neural") {
    const x1 = compact ? 108 : 118;
    const x2 = compact ? 168 : 188;
    const x3 = compact ? 228 : 252;
    const xO = compact ? 278 : 308;
    const c1 = 4;
    const c2 = 3;
    const c3 = 2;
    const p1 = positionsColumn(x1, top, bottom, c1);
    const p2 = positionsColumn(x2, top, bottom, c2);
    const p3 = positionsColumn(x3, top, bottom, c3);
    const pO = positionsColumn(xO, top, bottom, 2);
    body = (
      <>
        {inPos.map((p, i) => (
          <Node key={`in-${i}`} cx={p.x} cy={p.y} r={rIn} className={`studio-training-viz__node--p${i % 5}`} />
        ))}
        {p1.map((p, i) => (
          <Node key={`h1-${i}`} cx={p.x} cy={p.y} r={rMid} className={`studio-training-viz__node--p${(i + 1) % 5}`} />
        ))}
        {p2.map((p, i) => (
          <Node key={`h2-${i}`} cx={p.x} cy={p.y} r={rMid} className={`studio-training-viz__node--p${(i + 2) % 5}`} />
        ))}
        {p3.map((p, i) => (
          <Node key={`h3-${i}`} cx={p.x} cy={p.y} r={rMid} className={`studio-training-viz__node--p${(i + 1) % 5}`} />
        ))}
        {pO.map((p, i) => (
          <Node
            key={`o-${i}`}
            cx={p.x}
            cy={p.y}
            r={rOut * (i === 0 ? 1 : 0.92)}
            className={`studio-training-viz__node--out studio-training-viz__node--p${i % 5}`}
          />
        ))}
        {fanEdges(
          inPos.map((p) => p.x),
          inPos.map((p) => p.y),
          p1.map((p) => p.x),
          p1.map((p) => p.y),
          0,
          edgeW
        )}
        {fanEdges(
          p1.map((p) => p.x),
          p1.map((p) => p.y),
          p2.map((p) => p.x),
          p2.map((p) => p.y),
          1,
          edgeW * 0.95
        )}
        {fanEdges(
          p2.map((p) => p.x),
          p2.map((p) => p.y),
          p3.map((p) => p.x),
          p3.map((p) => p.y),
          2,
          edgeW * 0.9
        )}
        {fanEdges(
          p3.map((p) => p.x),
          p3.map((p) => p.y),
          pO.map((p) => p.x),
          pO.map((p) => p.y),
          3,
          edgeW * 1.02
        )}
      </>
    );
  } else if (modelType === "tabular_orchestrator") {
    const xB = compact ? 100 : 108;
    const xU = compact ? 128 : 142;
    const mid = (top + bottom) / 2;
    const yU = mid - (compact ? 10 : 12);
    const yB = mid + (compact ? 10 : 12);
    const xM = compact ? 188 : 208;
    const xO = compact ? 268 : 300;
    const upper = { x: xM, y: mid - (compact ? 7 : 9) };
    const lower = { x: xM, y: mid + (compact ? 7 : 9) };
    const out = { x: xO, y: mid };
    body = (
      <>
        {inPos.map((p, i) => (
          <Node key={`in-${i}`} cx={p.x} cy={p.y} r={rIn} className={`studio-training-viz__node--p${i % 5}`} />
        ))}
        <Node cx={xB} cy={yB} r={rMid} className="studio-training-viz__node--p2" />
        <Node cx={xU} cy={yU} r={rMid} className="studio-training-viz__node--p4" />
        <Node cx={upper.x} cy={upper.y} r={rMid} className="studio-training-viz__node--p1" />
        <Node cx={lower.x} cy={lower.y} r={rMid} className="studio-training-viz__node--p3" />
        <Node cx={out.x} cy={out.y} r={rOut} className="studio-training-viz__node--out studio-training-viz__node--p0" />
        {fanEdges(
          inPos.map((p) => p.x),
          inPos.map((p) => p.y),
          [xB, xU],
          [yB, yU],
          0,
          edgeW
        )}
        <Edge x1={xB} y1={yB} x2={upper.x} y2={upper.y} dashClass="studio-training-viz__dash--1" strokeWidth={edgeW} />
        <Edge x1={xU} y1={yU} x2={lower.x} y2={lower.y} dashClass="studio-training-viz__dash--2" strokeWidth={edgeW} />
        <Edge x1={upper.x} y1={upper.y} x2={out.x} y2={out.y} dashClass="studio-training-viz__dash--3" strokeWidth={edgeW * 1.02} />
        <Edge x1={lower.x} y1={lower.y} x2={out.x} y2={out.y} dashClass="studio-training-viz__dash--0" strokeWidth={edgeW * 1.02} />
      </>
    );
  } else {
    const xH = compact ? 124 : 138;
    const xO = compact ? 248 : 272;
    const outCount = 3;
    const oPos = positionsColumn(xO, top, bottom, outCount);
    const hPos = positionsColumn(xH, top, bottom, 2);
    body = (
      <>
        {inPos.map((p, i) => (
          <Node key={`in-${i}`} cx={p.x} cy={p.y} r={rIn} className={`studio-training-viz__node--p${i % 5}`} />
        ))}
        {hPos.map((p, i) => (
          <Node key={`h-${i}`} cx={p.x} cy={p.y} r={rMid} className={`studio-training-viz__node--p${(i + 2) % 5}`} />
        ))}
        {oPos.map((p, i) => (
          <Node
            key={`o-${i}`}
            cx={p.x}
            cy={p.y}
            r={rOut * (0.9 + 0.06 * (acc01 != null ? acc01 : 1 - lossNorm))}
            className={`studio-training-viz__node--out studio-training-viz__node--p${i % 5}`}
          />
        ))}
        {fanEdges(
          inPos.map((p) => p.x),
          inPos.map((p) => p.y),
          hPos.map((p) => p.x),
          hPos.map((p) => p.y),
          0,
          edgeW
        )}
        {fanEdges(
          hPos.map((p) => p.x),
          hPos.map((p) => p.y),
          oPos.map((p) => p.x),
          oPos.map((p) => p.y),
          1,
          edgeW * 1.02
        )}
      </>
    );
  }

  const sparkFillGradientId = `stv-spark-${sparkFillId}`;

  return (
    <div className={rootClass} style={rootStyle}>
      <svg className="studio-training-viz__svg" viewBox={vb} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs>
          <linearGradient id={sparkFillGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6aa3ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9d7bff" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        {body}
        {spark ? (
          <g className="studio-training-viz__spark">
            <polygon points={spark.area} fill={`url(#${sparkFillGradientId})`} className="studio-training-viz__spark-area" />
            <polyline
              points={spark.line}
              fill="none"
              className="studio-training-viz__spark-line"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ) : null}
        <g className="studio-training-viz__captions">
          <text
            x={cxTitle}
            y={yTitle}
            textAnchor="middle"
            className="studio-training-viz__svg-caption studio-training-viz__svg-caption--lane"
          >
            {laneTitle}
          </text>
          {spark ? (
            <text
              x={cxSparkCap}
              y={ySparkCap}
              textAnchor="middle"
              className="studio-training-viz__svg-caption studio-training-viz__svg-caption--spark"
            >
              {sparkCaption}
            </text>
          ) : (
            <text
              x={cxSparkCap}
              y={ySparkCap}
              textAnchor="middle"
              className="studio-training-viz__svg-caption studio-training-viz__svg-caption--spark studio-training-viz__svg-caption--waiting"
            >
              После 1-й эпохи — мини-график ошибки (loss)
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
