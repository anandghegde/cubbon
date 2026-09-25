/**
 * Bases files (PRD FR5.8). View types: table, cards, list and kanban are core in Obsidian 1.14.
 * Property names match the frontmatter written by the entity renderers.
 */
const PROJECTS = `filters:
  and:
    - file.inFolder("wiki/Projects")
    - type == "project"
properties:
  status:
    displayName: Status
  status_since:
    displayName: Since
  owner:
    displayName: Owner
  team:
    displayName: Team
  target:
    displayName: Target
  last_seen:
    displayName: Last seen
  sources:
    displayName: Sources
views:
  - type: kanban
    name: Board
    groupBy:
      property: status
    order:
      - file.name
      - owner
      - target
      - status_since
  - type: table
    name: All projects
    order:
      - file.name
      - status
      - owner
      - team
      - target
      - status_since
      - last_seen
      - sources
    sort:
      - property: status_since
        direction: DESC
  - type: table
    name: At risk
    filters:
      or:
        - status == "at-risk"
        - status == "blocked"
    order:
      - file.name
      - status
      - status_since
      - owner
      - target
`;

const MILESTONES = `filters:
  and:
    - file.inFolder("wiki/Milestones")
    - type == "milestone"
properties:
  project:
    displayName: Project
  target:
    displayName: Target
  target_was:
    displayName: Was
  status:
    displayName: Status
  owner:
    displayName: Owner
views:
  - type: table
    name: By target date
    order:
      - file.name
      - project
      - target
      - target_was
      - status
      - owner
    sort:
      - property: target
        direction: ASC
  - type: table
    name: Slipped
    filters:
      and:
        - target_was != null
    order:
      - file.name
      - project
      - target
      - target_was
      - status
`;

const BLOCKERS = `filters:
  and:
    - file.inFolder("wiki/Blockers")
    - type == "blocker"
properties:
  status:
    displayName: Status
  opened:
    displayName: Opened
  resolved:
    displayName: Resolved
  owner:
    displayName: Owner
  blocks:
    displayName: Blocks
views:
  - type: table
    name: Open
    filters:
      and:
        - status == "open"
    order:
      - file.name
      - blocks
      - opened
      - owner
    sort:
      - property: opened
        direction: ASC
  - type: table
    name: All
    order:
      - file.name
      - status
      - blocks
      - opened
      - resolved
      - owner
`;

const COMMITMENTS = `filters:
  and:
    - file.inFolder("wiki/Commitments")
    - type == "commitment"
properties:
  status:
    displayName: Status
  assignee:
    displayName: Assignee
  due:
    displayName: Due
  done:
    displayName: Done
  project:
    displayName: Project
views:
  - type: table
    name: Open by assignee
    filters:
      and:
        - status != "done"
    groupBy:
      property: assignee
    order:
      - file.name
      - due
      - project
      - status
    sort:
      - property: due
        direction: ASC
  - type: table
    name: Overdue
    filters:
      and:
        - status == "overdue"
    order:
      - file.name
      - assignee
      - due
      - project
  - type: table
    name: All
    order:
      - file.name
      - status
      - assignee
      - due
      - done
      - project
`;

export const BASES: Record<string, string> = {
  'bases/Projects.base': PROJECTS,
  'bases/Milestones.base': MILESTONES,
  'bases/Blockers.base': BLOCKERS,
  'bases/Commitments.base': COMMITMENTS,
};
