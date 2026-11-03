# 발표 자료 PPTX 한 파일로 영상까지 나오게 한다.
# 덱(claude.ai Slides)에서 내려받은 PPTX는 영상 장에 멈춘 그림만 들어 있다. 그 그림을 MP4로 바꿔 넣고
# (같은 자리·크기, 재생 전 그림은 영상 마지막 장면), 글꼴을 파일 안에 넣어 저장한다. PowerPoint가 있는 Windows에서 돌린다.
# 내려받은 PPTX는 문단에 eaLnBrk가 없고 글자 언어가 en-US라 PowerPoint가 한글 낱말을 중간에서 끊는다(웹 덱은 낱말 단위).
# 그래서 열기 전에 모든 장의 문단에 eaLnBrk="0"(동아시아 낱말을 끊지 않음)을 넣고 글자 언어를 ko-KR로 붙이며,
# 가운뎃점(·)은 앞말에 붙여 줄 맨 앞에 오지 않게 한다. 낱말 단위로 바뀌어 넘치는 글 상자는 맞을 때까지 글자를 줄인다.
#
#   powershell -ExecutionPolicy Bypass -File presentation/embed-video.ps1 -In <내려받은.pptx> -Out <저장할.pptx> [-Images <폴더>]
#
# -Match: 바꿀 그림을 찾는 대체 텍스트 조각 (영상 장 그림의 대체 텍스트 "… 19.5초")
# -SlideNo: 대체 텍스트로 못 찾으면 이 장에서 가장 큰 그림을 바꾼다 (영상 장은 2장)
# -Images: 주면 저장한 파일의 모든 장을 PNG로 뽑는다 (확인용)
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Video = "promo\out\v3\promo-16x9.mp4",
  [string]$Poster = "promo\out\v3\keyvisual-16x9.png",
  [string]$Match = "19.5",
  [int]$SlideNo = 2,
  [string]$Images = ""
)
$ErrorActionPreference = "Stop"
$In = (Resolve-Path $In).Path
$Video = (Resolve-Path $Video).Path
$Poster = (Resolve-Path $Poster).Path
$Out = [System.IO.Path]::GetFullPath($Out)

# 받은 파일은 그대로 두고 복사본의 장 XML만 고친다
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("embed-video-" + [guid]::NewGuid().ToString("N") + ".pptx")
Copy-Item $In $work
$zip = [System.IO.Compression.ZipFile]::Open($work, "Update")
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($entry in @($zip.Entries)) {
  if ($entry.FullName -notmatch '^ppt/slides/slide\d+\.xml$') { continue }
  $reader = New-Object System.IO.StreamReader($entry.Open(), $utf8)
  $xml = $reader.ReadToEnd(); $reader.Close()
  $xml = [regex]::Replace($xml, '<a:pPr(?![^>]*eaLnBrk)', '<a:pPr eaLnBrk="0"')
  $xml = [regex]::Replace($xml, '<a:p>(?!<a:pPr)', '<a:p><a:pPr eaLnBrk="0"/>')
  # 글자 언어가 en-US면 PowerPoint가 위 설정을 한글에 쓰지 않는다 — 한국어로 붙인다
  $xml = [regex]::Replace($xml, '(<a:(?:rPr|endParaRPr|defRPr)[^>]*?) lang="en-US"(?![^>]*altLang)', '$1 lang="ko-KR" altLang="en-US"')
  $xml = $xml.Replace(" " + [char]0xB7 + " ", [string][char]0xA0 + [char]0xB7 + " ")
  $name = $entry.FullName
  $entry.Delete()
  $writer = New-Object System.IO.StreamWriter($zip.CreateEntry($name).Open(), $utf8)
  $writer.Write($xml); $writer.Close()
}
$zip.Dispose()

# 사용자가 이미 켜 둔 PowerPoint는 끄지 않는다
$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($work, 0, 0, 0)   # 읽기 전용 아님, 창 없음

  # 넘치는 글 상자: 글자를 4%씩 줄여 맞춘다. 폭과 글자 크기가 같은 상자(나란한 카드)는 같은 비율로 같이 줄인다
  function Get-TextShapes($shapes) {
    foreach ($sh in $shapes) {
      if ($sh.Type -eq 6) { Get-TextShapes $sh.GroupItems }   # 6 = 묶음
      elseif ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $sh }
    }
  }
  function Test-Overflow($sh) { $sh.TextFrame.TextRange.BoundHeight -gt $sh.Height * 1.15 + 1 }
  function Resize-Text($sh, [double]$k) {
    $tr = $sh.TextFrame.TextRange
    for ($i = 1; $i -le $tr.Runs().Count; $i++) { $run = $tr.Runs($i); $run.Font.Size = [math]::Round($run.Font.Size * $k, 1) }
    for ($i = 1; $i -le $tr.Paragraphs().Count; $i++) {
      $pf = $tr.Paragraphs($i).ParagraphFormat
      if ($pf.LineRuleWithin -eq 0) { $pf.SpaceWithin = [math]::Round($pf.SpaceWithin * $k, 1) }   # 줄 간격이 pt로 정해진 문단
    }
  }
  foreach ($s in $pres.Slides) {
    $texts = @(Get-TextShapes $s.Shapes)
    foreach ($t in $texts) {
      if (-not (Test-Overflow $t)) { continue }
      $size = $t.TextFrame.TextRange.Runs(1).Font.Size
      $peers = @($texts | Where-Object { $_ -ne $t -and [math]::Abs($_.Width - $t.Width) -le $t.Width * 0.05 -and $_.TextFrame.TextRange.Runs(1).Font.Size -eq $size })
      $steps = 0
      while ((Test-Overflow $t) -and $steps -lt 6) { Resize-Text $t 0.96; $steps++ }
      foreach ($p in $peers) { Resize-Text $p ([math]::Pow(0.96, $steps)) }
      "slide {0}: shrank '{1}' and {2} peers to {3:P0}" -f $s.SlideIndex, $t.Name, $peers.Count, [math]::Pow(0.96, $steps)
    }
  }

  $slide = $null; $pic = $null
  foreach ($s in $pres.Slides) {
    foreach ($sh in $s.Shapes) {
      if ($sh.Type -eq 13 -and $sh.AlternativeText -like "*$Match*") { $slide = $s; $pic = $sh }   # 13 = 그림
    }
  }
  if (-not $pic) {
    $slide = $pres.Slides.Item($SlideNo)
    foreach ($sh in $slide.Shapes) {
      if ($sh.Type -eq 13 -and (-not $pic -or $sh.Width * $sh.Height -gt $pic.Width * $pic.Height)) { $pic = $sh }
    }
    if (-not $pic) { throw "no picture on slide $SlideNo" }
    "alt text '$Match' not found; using the largest picture on slide $SlideNo"
  }

  $l = $pic.Left; $t = $pic.Top; $w = $pic.Width; $h = $pic.Height
  $movie = $slide.Shapes.AddMediaObject2($Video, 0, -1, $l, $t, $w, $h)   # 파일에 넣음(링크 아님)
  $movie.MediaFormat.SetDisplayPictureFromFile($Poster)
  $movie.AlternativeText = $pic.AlternativeText
  $movie.Name = "intro-video"
  $pic.Delete()

  # 그 장에서 다음 키(클리커)를 한 번 누르면 재생, 한 번 돌고 마지막 장면에 멈춤. 영상을 누르면 멈춤·다시 재생
  $play = $movie.AnimationSettings.PlaySettings
  $play.PlayOnEntry = -1
  $play.LoopUntilStopped = 0
  $play.RewindMovie = 0
  $play.HideWhileNotPlaying = 0
  $slide.TimeLine.MainSequence.Item(1).Timing.TriggerType = 1   # 1 = 클릭할 때(다음 키)

  $pres.SaveAs($Out, 24, -1)   # 24 = .pptx, 글꼴 넣기
  $effects = $slide.TimeLine.MainSequence.Count
  "slide {0}: video {1:N0} x {2:N0} pt, effects {3} -> {4}" -f $slide.SlideIndex, $w, $h, $effects, $Out
  if ($Images) {
    New-Item -ItemType Directory -Force $Images | Out-Null
    $pres.Export([System.IO.Path]::GetFullPath($Images), "PNG", 1920, 1080)
  }
  $pres.Close()
}
finally {
  if (-not $wasRunning) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  Remove-Item $work -ErrorAction SilentlyContinue
}
