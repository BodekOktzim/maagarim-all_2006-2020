import React from "react";
import type { Person } from "@sdl/types";

export interface PersonProfileProps {
  person: Person;
  sourceCount: number;
  relationshipCount: number;
}

export function PersonProfile({ person, sourceCount, relationshipCount }: PersonProfileProps) {
  return (
    <div className="person-profile">
      <h2>{person.firstName} {person.lastName}</h2>
      <dl>
        <dt>Synthetic ID</dt>
        <dd>{person.syntheticPersonId}</dd>
        <dt>Phone</dt>
        <dd>{person.phone ?? "—"}</dd>
        <dt>Address</dt>
        <dd>{person.address ?? "—"}</dd>
        <dt>Sources</dt>
        <dd>{sourceCount}</dd>
        <dt>Relationships</dt>
        <dd>{relationshipCount}</dd>
      </dl>
    </div>
  );
}

export interface DashboardProps {
  totalPeople: number;
  totalRecords: number;
  totalRelationships: number;
  totalSources: number;
  conflicts: number;
}

export function Dashboard(props: DashboardProps) {
  const stats: Array<[string, number]> = [
    ["Total Synthetic People", props.totalPeople],
    ["Total Records", props.totalRecords],
    ["Total Relationships", props.totalRelationships],
    ["Total Sources", props.totalSources],
    ["Conflicts", props.conflicts],
  ];
  return (
    <div className="dashboard">
      {stats.map(([label, value]) => (
        <div className="stat-card" key={label}>
          <div className="stat-value">{value.toLocaleString()}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}
