param([Parameter(Mandatory=$true)][ValidateSet('publish','connect')][string]$Operation, [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ProfileKey)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted=@($user.Value, 'S-1-5-18', 'S-1-5-32-544')
$base=[Environment]::GetFolderPath('LocalApplicationData')
if (-not $base) { throw 'Private local directory unavailable' }
# Reject redirected or reparse-point paths before touching a rendezvous file.
$parent=[IO.DirectoryInfo]::new($base)
while ($parent) {
  if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected directory' }
  $parent=$parent.Parent
}
$baseAcl=[IO.Directory]::GetAccessControl($base)
if ($baseAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Unexpected owner' }
foreach ($ace in $baseAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($ace.AccessControlType -ne 'Allow' -or $ace.IdentityReference.Value -in $trusted) { continue }
  $write=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  if ($ace.FileSystemRights -band $write) { throw 'Writable parent' }
}
$directory=[IO.DirectoryInfo]::new([IO.Path]::Combine($base,'FitBayMusicAgent'))
if ($Operation -eq 'publish' -and -not $directory.Exists) {
  $security=[Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true,$false)
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($user,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $security.AddAccessRule($rule)
  $directory.Create($security)
}
$directory.Refresh()
if (-not $directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Private directory unavailable' }
$actual=$directory.GetAccessControl()
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'Unexpected access control' }
foreach ($ace in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -ne $user.Value) { throw 'Directory shared' }
}
$endpoint=[IO.FileInfo]::new([IO.Path]::Combine($directory.FullName,$ProfileKey+'.json'))
if ($endpoint.Exists) {
  if ($endpoint.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected endpoint' }
  $acl=$endpoint.GetAccessControl()
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'Unexpected endpoint owner' }
  foreach ($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -ne $user.Value) { throw 'Shared endpoint' }
  }
}
[Console]::Write($endpoint.FullName)
