# Winter App — 업데이트 & 릴리즈 가이드

## 원클릭 업데이트

```bash
bash winter-update.sh
```

끝. 아래는 이게 내부적으로 뭘 하는지 설명.

---

## 수동으로 할 때 (단계별)

### 1단계: 코드 수정
파일 수정하고 저장. 끝.

### 2단계: 버전 올리기
3개 파일에서 버전 숫자를 바꿔야 함. (예: `0.2.0` → `0.3.0`)

| 파일 | 위치 |
|------|------|
| `package.json` | 4번째 줄 `"version": "0.2.0"` |
| `src-tauri/Cargo.toml` | 4번째 줄 `version = "0.2.0"` |
| `src-tauri/tauri.conf.json` | 4번째 줄 `"version": "0.2.0"` |

**3개 다 같은 숫자여야 함.**

### 3단계: 커밋
```bash
git add -A
git commit -m "feat: 여기에 뭘 바꿨는지 한줄 설명"
```

### 4단계: 푸시
```bash
git push origin main
```

### 5단계: 태그 만들기
```bash
git tag v0.3.0
```
(버전 숫자 앞에 `v` 붙여야 함)

### 6단계: 태그 푸시
```bash
git push origin v0.3.0
```

이 순간 GitHub Actions가 자동으로:
- Windows `.msi` 인스톨러
- Mac `.dmg` (Intel + Apple Silicon)
- Linux `.deb` + `.AppImage`

를 빌드해서 https://github.com/gyugoat/winter-app/releases 에 올림.

### 7단계: 확인
```bash
gh run list --limit 1
```
`completed success` 나오면 끝. 15분 정도 걸림.

---

## 버전 규칙

`X.Y.Z` (예: `0.2.0`)

| 자리 | 언제 올림 | 예시 |
|------|----------|------|
| Z (패치) | 버그 수정 | `0.2.0` → `0.2.1` |
| Y (마이너) | 새 기능 추가 | `0.2.0` → `0.3.0` |
| X (메이저) | 큰 변경, 호환 깨짐 | `0.9.0` → `1.0.0` |

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| 릴리즈가 안 만들어짐 | `gh run list --limit 3` 으로 워크플로 상태 확인 |
| 태그가 이미 있다고 나옴 | `git tag -d v0.3.0 && git push origin :refs/tags/v0.3.0` 로 삭제 후 재시도 |
| 빌드 실패 | `gh run view [run-id] --log-failed` 로 에러 확인 |
| push 안됨 | `gh auth status` 로 로그인 상태 확인 |

---

## 파일 구조

```
.github/workflows/
├── ci.yml       ← push할 때마다 자동: tsc 타입체크 + cargo check
└── release.yml  ← v* 태그 push할 때만: 인스톨러 빌드 + GitHub Release 생성
```
