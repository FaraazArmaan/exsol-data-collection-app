import { Link } from 'react-router-dom';
import type { StaffResource, TeamMember } from '../../shared/api';

export function teamMembersFromResources(resources: StaffResource[]): TeamMember[] {
  const byId = new Map<string, TeamMember>();
  for (const resource of resources) {
    for (const member of resource.team_members) {
      if (!byId.has(member.id)) byId.set(member.id, member);
    }
  }
  return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function teamMemberLabel(member: TeamMember): string {
  const bits = [
    member.display_name,
    member.level_label ? `Level ${member.level_number ?? '?'} - ${member.level_label}` : member.role_label,
    member.email,
  ].filter(Boolean);
  return bits.join(' - ');
}

export function findTeamMember(resources: StaffResource[], userNodeId: string | null | undefined): TeamMember | null {
  if (!userNodeId) return null;
  return teamMembersFromResources(resources).find((member) => member.id === userNodeId) ?? null;
}

interface TeamEmployeePickerProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  members: TeamMember[];
  required?: boolean;
  disabled?: boolean;
  includeBlank?: boolean;
  blankLabel?: string;
}

export function TeamEmployeePicker({
  id,
  label,
  value,
  onChange,
  members,
  required = false,
  disabled = false,
  includeBlank = true,
  blankLabel = 'Select employee...',
}: TeamEmployeePickerProps) {
  return (
    <label className="wf-label">
      {label}
      <select
        id={id}
        className="wf-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled || members.length === 0}
      >
        {includeBlank && <option value="">{members.length === 0 ? 'No Team users available' : blankLabel}</option>}
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {teamMemberLabel(member)}
          </option>
        ))}
      </select>
    </label>
  );
}

interface TeamStatusCardProps {
  member: TeamMember | null;
  slug: string;
  emptyText?: string;
}

export function TeamStatusCard({ member, slug, emptyText = 'Select a Team user to view account context.' }: TeamStatusCardProps) {
  if (!member) {
    return <div className="wf-team-card wf-team-card-muted">{emptyText}</div>;
  }

  const level = member.level_label
    ? `Level ${member.level_number ?? '?'} - ${member.level_label}`
    : member.level_number === null
      ? 'Unassigned access'
      : `Level ${member.level_number}`;

  return (
    <div className="wf-team-card">
      <div className="wf-team-card-main">
        <div>
          <div className="wf-team-name">{member.display_name}</div>
          <div className="wf-team-meta">{member.email ?? 'No login email'} - {level}</div>
          <div className="wf-team-meta">{member.role_label ?? 'No role label'}</div>
        </div>
        <div className="wf-team-tags">
          <span className={member.has_login ? 'wf-team-tag ok' : 'wf-team-tag'}>
            {member.has_login ? 'Login enabled' : 'No login'}
          </span>
          {member.login_disabled && <span className="wf-team-tag danger">Disabled in Team</span>}
        </div>
      </div>
      <Link className="wf-team-link" to={`/c/${slug}/team`}>
        Manage access in Team
      </Link>
    </div>
  );
}
