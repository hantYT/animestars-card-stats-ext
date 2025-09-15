# PowerShell script to create simple PNG icons
Add-Type -AssemblyName System.Drawing

# Function to create a simple icon
function Create-Icon {
    param($size, $filename)
    
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    
    # Set background
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26, 26, 46))
    $graphics.FillRectangle($brush, 0, 0, $size, $size)
    
    # Draw card shape
    $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 33, 62))
    $cardRect = New-Object System.Drawing.Rectangle([int]($size * 0.15), [int]($size * 0.2), [int]($size * 0.7), [int]($size * 0.6))
    $graphics.FillRectangle($cardBrush, $cardRect)
    
    # Draw star symbol
    $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Gold)
    $starSize = [int]($size * 0.3)
    $starX = [int]($size * 0.35)
    $starY = [int]($size * 0.25)
    $starRect = New-Object System.Drawing.Rectangle($starX, $starY, $starSize, $starSize)
    $graphics.FillEllipse($starBrush, $starRect)
    
    # Draw stats bars
    $bar1 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(79, 195, 247))
    $bar2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 112, 67))
    $bar3 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(102, 187, 106))
    
    $barWidth = [int]($size * 0.15)
    $barHeight = [int]($size * 0.06)
    $barY = [int]($size * 0.7)
    
    $graphics.FillRectangle($bar1, [int]($size * 0.2), $barY, $barWidth, $barHeight)
    $graphics.FillRectangle($bar2, [int]($size * 0.425), $barY, $barWidth, $barHeight)
    $graphics.FillRectangle($bar3, [int]($size * 0.65), $barY, $barWidth, $barHeight)
    
    # Save
    $bitmap.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Cleanup
    $graphics.Dispose()
    $bitmap.Dispose()
    $brush.Dispose()
    $cardBrush.Dispose()
    $starBrush.Dispose()
    $bar1.Dispose()
    $bar2.Dispose()
    $bar3.Dispose()
}

# Create icons
Create-Icon 16 "icon16.png"
Create-Icon 48 "icon48.png" 
Create-Icon 128 "icon128.png"

Write-Host "Icons created successfully!"
