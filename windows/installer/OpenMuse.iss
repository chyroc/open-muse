; The Windows installer: a per-user install into %LOCALAPPDATA%\Programs\Open Muse,
; with no administrator rights, a Start menu shortcut carrying the app's
; AppUserModelID, and an entry in Installed apps. scripts/build-windows.mjs
; compiles it with Inno Setup 6 after publishing the app:
;
;   ISCC /DAppVersion=<version> /DSourceDir=<publish folder> /DOutputDir=<folder>
;        [/DZhMessages=<ChineseSimplified.isl>] OpenMuse.iss
;
; The app updates itself in place (see UpdateHandler), so the installer is
; only for the first install; running a newer one over an install also works.
; Uninstalling keeps the person's data in %LOCALAPPDATA%\Open Muse, as
; removing the Mac app keeps its data.

#ifndef AppVersion
  #error Define AppVersion
#endif
#ifndef SourceDir
  #error Define SourceDir
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
; Also named in UpdateHandler, which keeps the entry's version current.
AppId={{6E9206ED-DDA8-4A02-BC41-05AB4C4DB6CB}
AppName=Open Muse
AppVersion={#AppVersion}
AppVerName=Open Muse {#AppVersion}
AppPublisher=Open Muse
AppPublisherURL=https://getopenmuse.com
AppSupportURL=https://getopenmuse.com/support/
DefaultDirName={localappdata}\Programs\Open Muse
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=OpenMuse-{#AppVersion}-setup
SetupIconFile={#SourceDir}\OpenMuse.ico
UninstallDisplayIcon={app}\OpenMuse.exe
UninstallDisplayName=Open Muse
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; A copy that is still open holds the OpenMuse.Running mutex. Setup and the
; uninstaller ask it to quit first (see QuitRunningApp) rather than using
; AppMutex, which only tells the person to close it themselves.
CloseApplications=no
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
; Inno Setup ships its Simplified Chinese messages as a contributed
; translation; the build script downloads that file and passes its path.
#ifdef ZhMessages
Name: "zh"; MessagesFile: "{#ZhMessages}"
#endif

[CustomMessages]
en.DesktopIcon=Create a desktop shortcut
en.WebView2Missing=Open Muse needs the Microsoft Edge WebView2 Runtime, which is not installed. Setup will download and install it from Microsoft now.
en.WebView2Failed=The Microsoft Edge WebView2 Runtime could not be installed. Install it from Microsoft, then open Open Muse.
en.StillRunning=Open Muse is still open. Quit it from its icon in the notification area, then continue.
#ifdef ZhMessages
zh.DesktopIcon=创建桌面快捷方式
zh.WebView2Missing=Open Muse 需要 Microsoft Edge WebView2 Runtime，这台电脑上还没有安装。安装程序现在会从 Microsoft 下载并安装它。
zh.WebView2Failed=没能安装 Microsoft Edge WebView2 Runtime。请从 Microsoft 安装后再打开 Open Muse。
zh.StillRunning=Open Muse 仍在运行。请从通知区域的图标退出它，然后继续。
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; An update replaces the whole folder; files a newer build no longer ships go.
Type: filesandordirs; Name: "{app}\web"

[Icons]
Name: "{userprograms}\Open Muse"; Filename: "{app}\OpenMuse.exe"; AppUserModelID: "OpenMuse.App"
Name: "{userdesktop}\Open Muse"; Filename: "{app}\OpenMuse.exe"; Tasks: desktopicon

[Registry]
; Run on startup is the app's own setting; uninstalling removes it.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Open Muse"; Flags: uninsdeletevalue dontcreatekey

[Run]
Filename: "{app}\OpenMuse.exe"; Description: "{cm:LaunchProgram,Open Muse}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Left by an update that was swapped in, and by an interrupted one.
Type: filesandordirs; Name: "{app}.old"

[Code]
const
  WebView2Client = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Bootstrapper = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasWebView2(): Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, WebView2Client, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

// Asks a running copy to quit through its own --quit request, which keeps
// any unsaved document behind its usual confirmation.
function QuitRunningApp(): Boolean;
var
  Code, Waited: Integer;
begin
  Result := True;
  if not CheckForMutexes('OpenMuse.Running') then
  begin
    Log('Open Muse is not running.');
    Exit;
  end;
  Log('Asking the running Open Muse to quit.');
  if FileExists(ExpandConstant('{app}\OpenMuse.exe')) then
    Exec(ExpandConstant('{app}\OpenMuse.exe'), '--quit', '', SW_HIDE, ewNoWait, Code);
  Waited := 0;
  while CheckForMutexes('OpenMuse.Running') and (Waited < 15000) do
  begin
    Sleep(250);
    Waited := Waited + 250;
  end;
  Result := not CheckForMutexes('OpenMuse.Running');
  if Result then
  begin
    // The mutex closes as the process ends; let Windows finish unloading it.
    Sleep(1000);
    Log('Open Muse quit.');
  end
  else
    Log('Open Muse is still running.');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if not QuitRunningApp() then
  begin
    Result := CustomMessage('StillRunning');
    Exit;
  end;
  if not HasWebView2() then
  begin
    if not WizardSilent() then
      MsgBox(CustomMessage('WebView2Missing'), mbInformation, MB_OK);
    try
      DownloadTemporaryFile(WebView2Bootstrapper, 'MicrosoftEdgeWebview2Setup.exe', '', nil);
      Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code);
    except
    end;
    if not HasWebView2() then
      Result := CustomMessage('WebView2Failed');
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := QuitRunningApp();
  if not Result then
    MsgBox(CustomMessage('StillRunning'), mbError, MB_OK);
end;
