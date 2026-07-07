import ChecklistPanel from './ChecklistPanel';

export default function OnboardingTab({ perms }: { perms: ReadonlySet<string> }) {
  return (
    <ChecklistPanel
      kind="onboarding"
      perms={perms}
      startLabel="Start onboarding"
      subjectLabel="New hire"
      emptyHint="Pick a new hire above to start their onboarding checklist. New hires are added in Manage Team."
    />
  );
}
