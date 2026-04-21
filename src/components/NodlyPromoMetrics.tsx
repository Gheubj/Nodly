import { useId, useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Демо-полоса accuracy + график loss — тот же визуальный язык, что на лендинге и в панели «Сцена».
 */
export function NodlyPromoMetrics({ className }: { className?: string }) {
  const lossGradUid = useId().replace(/:/g, "");
  const lossDemoRows = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const epoch = i + 1;
        const t = i / 27;
        return {
          epoch,
          loss: 1.12 * Math.exp(-t * 2.85) + 0.065 + Math.sin(epoch * 0.38) * 0.032,
          valLoss: 1.26 * Math.exp(-t * 2.48) + 0.095 + Math.cos(epoch * 0.31) * 0.038
        };
      }),
    []
  );

  return (
    <div className={`nodly-promo-metrics ${className ?? ""}`} aria-hidden>
      <div className="nodly-promo-metrics__meter">
        <span className="nodly-promo-metrics__meter-fill" />
      </div>
      <div className="nodly-promo-metrics__legend">
        <span>accuracy</span>
        <strong>0.94</strong>
      </div>
      <div className="nodly-promo-metrics__loss">
        <div className="nodly-promo-metrics__loss-head">
          <span>loss</span>
          <span className="nodly-promo-metrics__loss-note">train · val</span>
        </div>
        <div className="nodly-promo-metrics__loss-chart">
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={lossDemoRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id={`${lossGradUid}-lt`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6aa3ff" />
                  <stop offset="100%" stopColor="#9d7bff" />
                </linearGradient>
                <linearGradient id={`${lossGradUid}-lv`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#30d7d2" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
              <XAxis dataKey="epoch" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background: "rgba(15, 23, 42, 0.88)",
                  fontSize: 11,
                  color: "#e2e8f0"
                }}
                labelStyle={{ color: "#94a3b8" }}
              />
              <Line
                type="monotone"
                dataKey="loss"
                name="train"
                stroke={`url(#${lossGradUid}-lt)`}
                dot={false}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <Line
                type="monotone"
                dataKey="valLoss"
                name="val"
                stroke={`url(#${lossGradUid}-lv)`}
                dot={false}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
