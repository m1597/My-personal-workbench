## ADDED Requirements

### Requirement: First empty workspace entry

The desktop workbench SHALL offer a direct action on a new empty workspace based on actual Music availability and SHALL preserve deliberately empty saved layouts.

#### Scenario: Music installed

- **WHEN** a new empty workspace has an installed Music component
- **THEN** 打开 Music opens the component in the workspace

#### Scenario: Music absent

- **WHEN** Music is absent and the user selects 添加组件
- **THEN** the workbench offers the real matching Windows Music installer and refreshes availability after installation or cancellation

#### Scenario: Previously used workspace

- **WHEN** the user closes the last component and restarts
- **THEN** the workspace stays empty without the first-run action
