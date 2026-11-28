@echo off
rem test-partner-bot 一括ビルド: 依存解決 → ビルド → テスト
setlocal
cd /d %~dp0
call npm install
if errorlevel 1 exit /b %errorlevel%
call npm run build
if errorlevel 1 exit /b %errorlevel%
call npm test
if errorlevel 1 exit /b %errorlevel%
echo ビルドとテストが完了しました。起動: npm start (.env が必要です)
endlocal
