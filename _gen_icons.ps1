$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot 'icon.png'
$iconsDir   = Join-Path $PSScriptRoot 'src-tauri\icons'
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir | Out-Null }

if (-not (Test-Path $sourcePath)) {
    throw "icon.png not found at $sourcePath"
}

$src = [System.Drawing.Image]::FromFile($sourcePath)
Write-Host ("Source: {0}x{1}" -f $src.Width, $src.Height)

function Resize-Png([System.Drawing.Image]$img, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

# 1) Copy a 512x512 icon.png for Tauri bundle
$png512 = Resize-Png $src 512
[System.IO.File]::WriteAllBytes((Join-Path $iconsDir 'icon.png'), $png512)
Write-Host "Wrote icon.png (512x512)"

# 2) Build a multi-size ICO (PNG-embedded entries, Vista+)
$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = @{}
foreach ($s in $sizes) { $pngs[$s] = Resize-Png $src $s }

$icoStream = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($icoStream)

# ICONDIR
$w.Write([UInt16]0)          # reserved
$w.Write([UInt16]1)          # type = 1 (icon)
$w.Write([UInt16]$sizes.Count)

$headerSize = 6 + (16 * $sizes.Count)
$offset = $headerSize

# ICONDIRENTRY[]
foreach ($s in $sizes) {
    $data = $pngs[$s]
    $dim = if ($s -ge 256) { 0 } else { [byte]$s }  # 0 means 256
    $w.Write([byte]$dim)                  # width
    $w.Write([byte]$dim)                  # height
    $w.Write([byte]0)                     # colorCount
    $w.Write([byte]0)                     # reserved
    $w.Write([UInt16]1)                   # planes
    $w.Write([UInt16]32)                  # bitCount
    $w.Write([UInt32]$data.Length)        # bytesInRes
    $w.Write([UInt32]$offset)             # imageOffset
    $offset += $data.Length
}

# Image data
foreach ($s in $sizes) {
    $w.Write($pngs[$s])
}

$icoBytes = $icoStream.ToArray()
$w.Dispose()
$icoStream.Dispose()

[System.IO.File]::WriteAllBytes((Join-Path $iconsDir 'icon.ico'), $icoBytes)
Write-Host ("Wrote icon.ico ({0} bytes, sizes: {1})" -f $icoBytes.Length, ($sizes -join ','))

$src.Dispose()
Write-Host "Done."
