# 开发运行：必须带 -tags dev，否则 Windows 上会弹出「需要 build tags」对话框
Set-Location $PSScriptRoot\..
go run -tags dev .
