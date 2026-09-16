import React from "react";
import type { Person } from "@sdl/types";
import type { SiblingResult } from "@sdl/relationships";

export interface FamilyGraphProps {
  person: Person;
  parents: Person[];
  siblings: SiblingResult[];
}

/**
 * Renders the family graph as inline SVG (section 49). Relationship colors
 * come from CSS custom properties (theme tokens), never hardcoded (section 51).
 */
export function FamilyGraph({ person, parents, siblings }: FamilyGraphProps) {
  const childNodes = [person, ...siblings.map((s) => s.person)];
  const width = 120 * (childNodes.length + 1);

  return (
    <svg viewBox={`0 0 ${width} 220`} role="img" aria-label={`Family graph for ${person.firstName ?? person.syntheticPersonId}`}>
      <style>{`
        .node-label { font: 12px sans-serif; fill: var(--sdl-text, #111); }
        .node-circle { fill: var(--sdl-parent, #6366f1); }
        .node-circle.self { fill: var(--sdl-self, #f59e0b); }
        .node-circle.sibling { fill: var(--sdl-sibling, #10b981); }
        .edge { stroke: var(--sdl-edge, #9ca3af); stroke-width: 2; }
      `}</style>

      {parents.map((parent, i) => {
        const x = width / 2 + (i === 0 ? -60 : 60);
        return (
          <g key={parent.syntheticPersonId}>
            <line x1={x} y1={40} x2={width / 2} y2={110} className="edge" />
            <circle cx={x} cy={30} r={20} className="node-circle" />
            <text x={x} y={65} textAnchor="middle" className="node-label">
              {parent.firstName ?? parent.syntheticPersonId}
            </text>
          </g>
        );
      })}

      {childNodes.map((child, i) => {
        const x = 60 + i * 120;
        const isSelf = child.syntheticPersonId === person.syntheticPersonId;
        return (
          <g key={child.syntheticPersonId}>
            <line x1={width / 2} y1={110} x2={x} y2={150} className="edge" />
            <circle cx={x} cy={160} r={20} className={`node-circle ${isSelf ? "self" : "sibling"}`} />
            <text x={x} y={195} textAnchor="middle" className="node-label">
              {child.firstName ?? child.syntheticPersonId}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
