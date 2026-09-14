# Script de lancamento automatico do Frame
# Modo de uso: .\lancar-versao.ps1 -Versao "1.5.1" -VersionCode 24

param (
    [Parameter(Mandatory=$true)]
    [string]$Versao,
    
    [Parameter(Mandatory=$true)]
    [int]$VersionCode
)

Write-Host "Iniciando lancamento da versao $Versao ($VersionCode)..." -ForegroundColor Cyan

Write-Host "1. Atualizando codigo de versao no app..."
cd Frame
node scripts/versao.mjs $Versao $VersionCode

Write-Host "2. Compilando APK Universal..."
cd android
.\gradlew assembleRelease
cd ..\..

$ApkPath = "Frame\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $ApkPath)) {
    Write-Host "Erro: APK nao foi gerado." -ForegroundColor Red
    exit
}

Write-Host "3. Fazendo upload pro GitHub Releases..."
.\bin\gh.exe release create "v$Versao" $ApkPath --repo firedart2099/frame --title "Frame v$Versao" --notes "Lancamento automatico"

Write-Host "4. Dando deploy no site..."
cd FrameWeb
npm run deploy
cd ..

Write-Host "Feito! Versao $Versao lancada com sucesso!" -ForegroundColor Green
