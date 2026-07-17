# AGENTS.md

## Claude Code 호환 지침

이 저장소는 Claude Code와 Codex를 함께 사용한다. 프로젝트 지침의 원본은 다음 파일이다.

1. `CLAUDE.md`
2. `CLAUDE.local.md` (파일이 존재할 때)

Codex는 작업을 분석하거나 파일을 수정하기 전에 위 파일을 순서대로 읽고, 두 파일의 지침을 현재 디렉터리의 `AGENTS.md` 지침과 동일하게 취급하여 준수한다.

- `CLAUDE.md`에는 저장소 공통 규칙과 프로젝트 정보를 둔다.
- `CLAUDE.local.md`에는 로컬 환경 및 운영 관련 추가 규칙을 둔다.
- 두 파일의 지침이 충돌하면 `CLAUDE.local.md`를 우선한다.
- 시스템, 개발자 또는 사용자의 현재 요청과 충돌하면 상위 지침을 우선한다.
- `.claude/skills/`와 `.claude/projects/**/memory/`의 Markdown 파일은 전역 지침으로 자동 적용하지 않는다. 현재 작업에 직접 관련되거나 사용자가 명시적으로 요청한 경우에만 읽고 활용한다.

Claude용 지침을 변경할 때는 원본인 `CLAUDE.md` 또는 `CLAUDE.local.md`만 수정하며, 이 파일에 내용을 복제하지 않는다.
