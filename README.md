# 이샛별 · 아나운서 · MC · 성우

공식행사 · 문화행사 · 성우MC · VIP 담당 아나운서 · 팀빌딩MC · 레크레이션MC 이샛별의 소개 페이지입니다.
`https://smingvoice.github.io` 에 올리는 것을 기준으로 만들었습니다.

## 페이지 구성 (큐시트 CUE 01–12)

| CUE | 섹션 | 내용 |
| --- | --- | --- |
| 00 | 인트로 | 점 → 음성 파형 → 이름 → 별빛으로 흩어지며 시작 (새로고침할 때마다 재생, 클릭·키 입력으로 건너뛰기) |
| 01 | 오프닝 | "마이크 뒤에선 성우, 마이크 잡으면 MC." · 목소리 듣기 · 프로필 영상 |
| 02 | 인사말 | 인사말 녹음(1번 테이크)에 맞춰 어절 단위로 밝아지는 대본, 강점 3가지, 숫자로 보는 경력 |
| 03 | 목소리 | 목소리 별자리(실제 샘플 32개 재생), 성우 크레딧, 유튜브 |
| 04 | 진행 스타일 | VIP ↔ 공식행사 ↔ 팀빌딩 ↔ 레크 텐션 페이더 |
| 05–08 | 네 가지 무대 | 공식행사 / 문화행사 · 성우MC / VIP 담당 아나운서 / 팀빌딩MC(+레크레이션MC) |
| 09 | 현장 기록 | 드래그로 돌리는 곡면 갤러리 |
| 10 | 후기 | 실제 메시지 후기, 크몽 평점 |
| 11 | 프로필 | 약력 · 자격 · 특기 · 방송촬영 · 강사 · 배우 |
| 12 | 클로징 | 섭외 연락처, 3D 명함 |

배경 하늘은 스크롤을 따라 밤에서 새벽, 해돋이로 바뀝니다. 목소리 샘플을 재생하면 샛별과 파형이 실제 음성에 반응합니다.

## 배포 (GitHub Pages)

- 저장소: https://github.com/smingvoice/smingvoice.github.io (smingvoice 조직)
- 주소: https://smingvoice.github.io — `main` 브랜치 루트를 그대로 서비스합니다(빌드 단계 없음, `.nojekyll`).
- 고친 뒤 반영: `git add . && git commit -m "수정 내용" && git push` 를 실행하면 1–2분 뒤 사이트에 반영됩니다.
- 카카오톡 등에 링크를 보내면 `assets/og.jpg` 가 미리보기로 뜹니다.

`resource/`(원본 PPT·사진·녹음 원본, 약 100MB)는 `.gitignore` 로 제외했습니다. GitHub는 50MB가 넘는 파일을 경고하거나 거부하기 때문입니다.

## 수정하는 곳

- 문구 · 경력 목록: `index.html`
- 디자인: `assets/css/main.css` · 글꼴: 본문·제목 Pretendard(`assets/fonts/pretendard/`, 직접 호스팅), 영문 포인트 Fraunces, 라벨·타임코드 IBM Plex Mono
- 목소리 샘플 목록(제목 · 톤 · 파형): `assets/js/voice-data.js`, 음원은 `assets/audio/`
- 인사말 녹음: `assets/audio/greeting.mp3` ("이샛별 오프닝 멘트" 1번 테이크, 29.6초). `voice-data.js` 맨 아래 `window.GREETING` 의 `words` 는 인사말 섹션 각 어절이 시작되는 시각(초)이라, 대본 문장을 고치면 녹음과 어절 수가 맞아야 하이라이트가 정확히 따라갑니다(어절 수가 다르면 글자 수 비례로 자동 전환).
- 하늘 색(섹션별 팔레트): `assets/js/sky.js` 상단 `P` 배열
- 모션: `assets/js/main.js`

## 시안 링크(claude.ai 아티팩트) 다시 만들기

```bash
python3 tools/build_artifact.py
```

`.artifact-build/index.html`(CSS·JS 인라인)과 함께 올릴 파일 목록 `files.json` 이 생깁니다. 이 페이지를 기존 아티팩트 주소로 다시 게시하면 링크가 그대로 유지됩니다.

## 자료 출처

- 경력 · 사진: `resource/` 의 MC 프로필, 성우 프로필, 진행경력 PDF, 명함
- 목소리 샘플: 성우 작업물 구글 드라이브 폴더(광고 · 캐릭터 · 내레이션 · CM송 · 교재)에서 32개를 골라 30초 안팎으로 다듬고 음량을 맞췄습니다.
- 웹에서 교차 확인한 내용: 데일리게임 GXG 2025 기사, 씨네21 &lt;마이 리틀 레나타&gt; 크레딧, 윌라 · 밀리의서재 낭독 크레딧, 게임 크레딧(타워 오브 판타지 '연묘', 디스라이트 '니콜'), 본인 유튜브 채널 영상
- 라이브러리: GSAP 3.15(ScrollTrigger · SplitText · ScrambleText), Lenis 1.3 · 글꼴: Pretendard 1.3.9(SIL OFL 1.1, `assets/fonts/pretendard/LICENSE.txt`), Fraunces · IBM Plex Mono(Google Fonts)
