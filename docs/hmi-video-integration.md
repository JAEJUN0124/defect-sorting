<!-- 서버 담당이 보낸 카메라 영상 연동 안내(받은 파일 이름 hmi-video-integration.md)의 사본입니다. 2026-10-17 사용자가 전달. 내용은 고치지 않습니다.
     HMI 쪽 구현: hmi-web-mockup/js/video.js, js/camera.js(브릿지) · HMI 쪽 사용법: xml-protocol.md 8장 · 밖에서 열 때 영상 중계: cloudflare.md -->

# HMI 카메라 영상 수신 연동 안내

- 작성일: 2026-10-17
- 보내는 쪽: ECP 브릿지 서버 담당
- 받는 쪽: HMI 담당
- 기준: 현재 서버에 구현된 영상 수신·전달 기능

HMI는 **브릿지 서버의 HTTP MJPEG 주소**에서 영상을 받습니다. 기존 `/ws/hmi`는 XML 명령·상태 통신에 계속 사용하고, 영상은 별도 HTTP 연결로 받습니다. 카메라 화면을 열기 위해 XML 명령이나 영상 수신 ACK를 보낼 필요는 없습니다.

## 1. 통신 구조와 웹페이지의 역할

```text
설비 PC의 카메라 1·2
  └─ WebSocket 바이너리 → 브릿지 서버 /ws/video
                            ├─ HTTP MJPEG /video/1.mjpg → HMI 탑뷰 화면
                            ├─ HTTP MJPEG /video/2.mjpg → HMI 그리퍼 화면
                            └─ HTTP JSON  /video/status → HMI 영상 수신 상태

HMI 제어·상태 ←─ WebSocket XML /ws/hmi ─→ 브릿지 서버
```

`/video`는 **브릿지 서버 프로그램이 직접 제공하는 두 카메라 확인 웹페이지**입니다. 외부 웹사이트나 별도 서버가 아니며, XML 통신 서버와 같은 PC·프로그램·5080 포트에서 제공합니다. HMI 개발 전 수신 확인용으로 열거나, HMI 화면 안에 그대로 넣어 사용할 수 있습니다.

HMI가 `/ws/video`에 접속하면 안 됩니다. 이 경로는 설비가 JPEG를 업로드하는 송신자 전용이며, HMI에 영상을 내려주는 WebSocket이 아닙니다. HMI는 설비 PC의 카메라 HTTP 서버나 8080 포트에 직접 접근할 필요가 없습니다.

## 2. HMI 접속 주소와 카메라 이름

현재 LAN 시험용 서버 주소는 `10.108.108.98:5080`입니다. IP나 외부 접속 포트가 바뀌면 아래 주소의 호스트·포트를 함께 바꿔 주세요. 다른 PC에서 `localhost`를 사용하면 해당 HMI PC 자신을 가리킵니다.

| 용도 | 주소 | 응답 형식 |
| --- | --- | --- |
| HMI 제어·상태 | `ws://10.108.108.98:5080/ws/hmi` | 기존 XML |
| 탑뷰 영상 | `http://10.108.108.98:5080/video/1.mjpg` | MJPEG 스트림 |
| 그리퍼 영상 | `http://10.108.108.98:5080/video/2.mjpg` | MJPEG 스트림 |
| 카메라 수신 상태 | `http://10.108.108.98:5080/video/status` | JSON |
| 두 카메라 확인 화면 | `http://10.108.108.98:5080/video` | HTML |

| HMI 기존 이름 | 서버 카메라 id | 표시할 영상 | 상대 경로 |
| --- | --- | --- | --- |
| `top` | `1` | 탑뷰 카메라 | `/video/1.mjpg` |
| `close` | `2` | 그리퍼 카메라 | `/video/2.mjpg` |

이번 연동에서는 `close` 화면에 그리퍼 영상을 연결해 주세요. 실제 설비가 다른 위치의 근접 카메라를 사용하는 경우, 설비 담당과 카메라 2의 위치·화면 이름을 맞춰 주세요. 서버 상태 JSON의 id는 문자열 `top`/`close`가 아닌 **숫자 1/2**입니다.

기존 HMI가 상대 경로를 처리할 때처럼, 연결한 WebSocket 주소의 호스트·포트를 유지하고 `ws`→`http`, `wss`→`https`로 바꿔 영상 주소를 만들 수 있습니다. HMI 자체 웹페이지의 호스트를 기준으로 상대 경로를 붙이지 않도록 주의해 주세요. 아래 예는 경로 앞에 별도 접두어가 없는 현재 배포 기준입니다.

```javascript
const server = new URL("ws://10.108.108.98:5080/ws/hmi");
server.protocol = server.protocol === "wss:" ? "https:" : "http:";
const topVideoUrl = new URL("/video/1.mjpg", server.origin).href;
const closeVideoUrl = new URL("/video/2.mjpg", server.origin).href;
const videoStatusUrl = new URL("/video/status", server.origin).href;
```

## 3. 웹 HMI에서 표시하는 방법

### 방법 A: 서버의 두 카메라 화면을 그대로 넣기

브라우저나 HMI의 웹뷰에서 아래 URL을 열면 됩니다. 웹 HMI에 넣을 때는 iframe을 사용할 수 있습니다.

```html
<iframe
  src="http://10.108.108.98:5080/video"
  title="설비 카메라"
  width="100%"
  height="720"
  style="border:0">
</iframe>
```

내장 화면은 두 카메라를 표시하고, 상태 조회가 끝난 뒤 약 1초 간격으로 다시 조회합니다. 상태 요청 제한 시간은 3초입니다. 오래된 영상이나 연결 오류를 확인하면 이미지를 숨기고, 새 프레임이 들어오면 다시 스트림을 엽니다. 별도 출처의 HMI에서 iframe으로 넣어도 화면 내부의 상태 조회는 브릿지 서버와 같은 출처에서 수행합니다.

### 방법 B: HMI 자체 카메라 화면에 개별 영상 넣기

기존 MJPEG 표시 기능에 위 카메라별 URL을 지정하세요. 웹에서는 다음과 같이 `img`로 표시할 수 있습니다.

```html
<img src="http://10.108.108.98:5080/video/1.mjpg" alt="탑뷰 실시간 영상">
<img src="http://10.108.108.98:5080/video/2.mjpg" alt="그리퍼 실시간 영상">
```

이는 **표시 방법만 보여 주는 최소 예제**입니다. 실제 HMI에는 4장의 상태 조회와 5장의 숨김·재접속 처리를 함께 적용해 주세요. `img`만 넣으면 전송이 끊겨도 마지막 이미지가 남을 수 있습니다. MJPEG는 JPEG 이미지의 연속이므로 일반 MP4용 `video` 요소에 주소만 넣는 방식으로 구현하지 마세요.

같은 카메라를 여러 HMI가 동시에 조회할 수 있습니다. 두 카메라를 직접 표시할 때는 카메라마다 HTTP 스트림 하나를 엽니다. 이미지 주소를 매초 다시 설정하지 말고, 정상 스트림은 유지하며 끊겼을 때만 다시 여세요.

## 4. 영상 수신 상태 조회

`GET /video/status`를 약 1초 간격으로 호출하고, 요청 제한 시간은 예를 들어 3초로 설정해 주세요. 응답은 **XML이 아닌 JSON**이며 캐시하지 않습니다. 한 요청이 끝난 다음 다음 조회를 예약하면 요청이 중첩되지 않습니다.

다음은 형식을 설명하기 위한 예시이며 현재 연결 상태를 나타내는 값은 아닙니다.

```json
{
  "connected": true,
  "freshnessMs": 5000,
  "cameras": [
    {
      "id": 1,
      "available": true,
      "receivedAt": "2026-10-17T06:00:00+00:00",
      "sourceTimestampMs": 1792216800000,
      "sequence": 12
    },
    {
      "id": 2,
      "available": false,
      "receivedAt": null,
      "sourceTimestampMs": null,
      "sequence": null
    }
  ]
}
```

| 필드 | 의미와 HMI 처리 |
| --- | --- |
| `connected` | 설비의 영상 업로드 WebSocket이 연결되어 있는지. 카메라가 촬영 중이거나 XML 제어 연결이 정상이라는 뜻은 아님 |
| `freshnessMs` | 서버가 프레임을 최근 수신으로 보는 시간. 현재 5000ms |
| `cameras[].id` | 숫자 1=탑뷰, 2=그리퍼. 배열 순서 대신 id로 찾기 |
| `available` | 해당 카메라의 정상 형식 프레임을 서버가 최근 5초 이내에 받았는지 |
| `receivedAt` | 마지막 정상 프레임의 서버 수신 시각, UTC. 미수신 또는 업로드 연결 종료·재접속 시 null |
| `sourceTimestampMs` | 설비가 넣은 촬영 시각 메타데이터, Unix epoch 밀리초. 설비 시계 정확도는 별도 확인 필요 |
| `sequence` | 설비가 보낸 0~65535 순번. 순환·반복·건너뜀이 가능하며, null은 미수신 |

`available`은 서버의 수신 시점을 기준으로 계산됩니다. 설비가 오래된 사진을 새 프레임처럼 반복 전송하는지, 카메라 촬영이 실제로 갱신되는지까지 검증하는 값은 아닙니다. 서버는 JPEG 전체를 디코딩하지 않으므로 **HMI 디코딩 실패 시에는 available=true여도 표시 오류로 처리**해 주세요.

시각을 화면에 표시할 때는 필요에 따라 UTC에서 한국표준시로 변환하세요. 유효성 판단을 HMI PC 시계와 `sourceTimestampMs`의 차이에만 의존하지 마세요.

## 5. 미수신·끊김·재접속 처리

| 상황 | HMI 표시 및 처리 |
| --- | --- |
| `connected=false` | 두 카메라 화면을 숨기고 “설비 영상 연결 대기” 표시 |
| `connected=true`, 해당 카메라 `available=false`, `receivedAt=null` | 해당 카메라 “영상 미수신” 표시 |
| 해당 카메라 `available=false`, `receivedAt` 값 있음 | 해당 카메라의 마지막 이미지를 숨기고 “5초 이상 새 영상 없음” 표시 |
| `available=true` | 해당 카메라 스트림이 없으면 연결. JPEG가 정상 표시되는지 확인 |
| 상태 요청 실패·제한 시간 초과 | 이전 영상을 숨기고 “영상 상태 확인 불가” 표시. 상태 조회 재시도 |
| 영상 HTTP 연결 종료·수신 오류·디코딩 오류 | 해당 이미지 숨김. 상태 조회 후 새 연결로 재시도 |

브라우저에서는 오류 시 `img`의 `src`를 제거하고 숨긴 뒤, 재시도 시 `/video/1.mjpg?t=현재시간`처럼 쿼리를 붙여 새 요청을 만들 수 있습니다. 이 쿼리는 요청 갱신용이며 서버가 영상 선택 조건으로 사용하지 않습니다. 재시도는 최소 1초 간격을 두고 반복 오류 시 2초, 최대 5초 정도로 늘려 주세요. 상태가 다시 유효해지면 정상 수신으로 복구합니다.

서버는 새 프레임을 기다리거나 HMI로 쓰는 작업이 약 5초를 넘으면 해당 MJPEG 연결을 종료할 수 있습니다. 첫 HTTP 응답이 200이어도 실제 JPEG가 아직 없을 수 있으므로, 200만 보고 “영상 정상”으로 표시하지 마세요.

수신 중단에서 화면 숨김까지는 5초의 유효 시간에 상태 조회·응답 처리 지연이 더해질 수 있습니다. 정확히 5초에 화면이 바뀐다고 보장하지 않습니다.

영상 연결은 XML 연결과 독립적으로 관리해 주세요. 영상이 끊겼다고 `/ws/hmi`를 재접속하거나 장비 제어 명령을 다시 보내지 않습니다. 카메라 1만 끊기면 카메라 2는 계속 표시할 수 있습니다. 서버는 영상 끊김을 근거로 장비 시작·정지 명령을 자동 발생시키지 않습니다.

## 6. 네이티브 HMI에서 직접 수신하는 경우

웹뷰에 `/video`를 표시하거나, 기존 MJPEG 지원 컴포넌트에 카메라 URL을 지정하는 방법을 사용할 수 있습니다. 직접 수신기를 구현한다면 HTTP 응답을 스트림으로 읽어 주세요.

응답 헤더는 다음과 같습니다.

```http
Content-Type: multipart/x-mixed-replace; boundary=frame
Cache-Control: no-store, no-cache
```

응답 본문은 아래 파트가 반복됩니다. 줄바꿈은 CRLF입니다. `N`과 `<JPEG 바이트 N개>`는 설명용 자리표시자입니다.

```text
--frame
Content-Type: image/jpeg
Content-Length: N
X-Sequence: 12
X-Timestamp-Ms: 1792216800000

<JPEG 바이트 N개>
--frame
Content-Type: image/jpeg
Content-Length: N
X-Sequence: 13
X-Timestamp-Ms: 1792216800033

<JPEG 바이트 N개>
```

1. 응답 헤더를 받은 즉시 스트림 읽기를 시작합니다. .NET이라면 `HttpCompletionOption.ResponseHeadersRead`를 사용하고, 전체 응답 완료를 기다리는 `GetStringAsync`나 전체 버퍼링 방식을 피하세요.
2. boundary와 파트 헤더를 읽은 뒤, 각 파트의 `Content-Length`만큼 JPEG 바이트를 모읍니다. 이 길이는 전체 HTTP 응답 길이가 아닙니다.
3. **HTTP 읽기 한 번이 JPEG 한 장이라는 보장은 없습니다.** 헤더·JPEG가 여러 번에 나뉘거나 여러 파트가 한 번에 올 수 있습니다. JPEG 바이너리를 문자열로 변환하거나 줄바꿈 기준으로 분할하지 마세요.
4. 이 서버의 JPEG 한 장 최대 크기는 4,194,304바이트입니다. 길이·헤더 크기를 제한하고, 잘못된 길이·불완전 JPEG·디코딩 실패 시 해당 스트림을 닫고 재접속합니다.
5. JPEG를 디코딩해 UI에 표시합니다. 처리가 느리면 오래된 프레임을 쌓지 말고 최신 프레임을 표시하며, 수신 작업이 UI나 XML 제어 수신을 막지 않게 구성합니다.
6. 스트림은 정상 운영 중 계속 열려 있으므로 전체 다운로드의 짧은 제한 시간 대신, 연결·읽기별 제한 시간과 화면 종료 시 취소를 사용하세요. EOF·소켓 오류·읽기 제한 시간 초과 시에도 재접속합니다.

`X-Sequence`와 `X-Timestamp-Ms`는 진단용 메타데이터입니다. 순번이 건너뛰거나 65535에서 0으로 돌아와도 정상일 수 있습니다. 여러 HMI의 표시 시점을 서로 동기화해 주는 기능은 없습니다.

HMI가 받는 각 파트에는 **JPEG만** 있습니다. 설비가 업로드할 때 쓰는 VID0/VID1 바이너리 헤더를 HMI가 파싱할 필요는 없습니다. 해상도와 FPS는 설비 송신값 및 통신 속도에 따라 달라지며 고정값을 가정하지 마세요. 음성·녹화·과거 영상 조회는 제공하지 않습니다.

## 7. 기존 HMI 구현에서 바꿀 부분

1. 기존 `top`/`close` 카메라 화면에 2장의 URL과 숫자 id 매핑을 적용해 주세요.
2. 이번 서버는 XML `Status`에 `<Camera ... url="..." transport="mjpeg" />`를 추가하지 않습니다. 이 요소나 카메라 명령 Reply가 와야만 영상을 여는 구조라면, 설정한 URL 또는 `/video`로 직접 열도록 변경해 주세요.
3. `CameraStart`·`CameraStop` XML 명령은 현재 지원하지 않습니다. 조회 시작은 HTTP 스트림 연결, 조회 종료는 해당 연결 닫기로 처리해 주세요. HMI 화면에서 영상을 숨기는 것과 설비 카메라 촬영을 끄는 것은 서로 다릅니다. 다른 HMI의 영상이나 설비 업로드는 계속될 수 있습니다.
4. 카메라 수신 상태는 `/video/status`를 기준으로 표시해 주세요. XML의 `RobotArm.connected`나 전체 `Status.source`로 카메라 상태를 대신 판단하지 마세요.
5. 기존 XML `Status` 자동 전송 주기는 **1분** 그대로입니다. 영상은 이 주기를 기다리지 않고 별도 스트림으로 전달됩니다. XML `GetStatus`·`Ping`·명령 Reply 처리도 기존대로 유지해 주세요.

## 8. 브라우저 출처·배포 조건

- 현재 서버에는 임의 출처의 JavaScript `fetch`를 허용하는 CORS 설정이 없습니다. HMI가 다른 포트·호스트 또는 `file://`에서 실행되면 `/video/status` 직접 fetch가 차단될 수 있습니다. 같은 출처로 전달하는 프록시를 두거나, 상태 처리까지 포함된 `/video`를 iframe으로 넣어 주세요. `mode: "no-cors"`로는 JSON을 읽을 수 없습니다. 브라우저의 출처 제한은 [MDN CORS 설명](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)을 참고하세요.
- 단순 `img` 표시는 상태 JSON 조회와 별개입니다. 다른 출처의 영상을 canvas로 읽거나 처리하려는 경우에도 별도 출처 허용 구성이 필요합니다. HMI 자체 CSP·웹뷰 정책이 영상 및 iframe 로드를 허용하는지 확인해 주세요.
- HTTPS로 제공하는 HMI에서는 영상·iframe·상태 API도 HTTPS, XML 연결도 WSS로 구성해야 합니다. 현재 시험용 서버의 직접 주소는 HTTP/WS입니다. 관련 브라우저 동작은 [MDN 혼합 콘텐츠 설명](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)을 참고하세요.
- 영상과 XML 모두 브릿지 서버의 TCP 5080을 사용합니다. 현재 같은 망 시험에서는 추가 영상 포트가 필요하지 않습니다. 외부 포트를 다르게 매핑했다면 HMI의 모든 주소에 해당 포트를 반영해 주세요.
- 현재 서버 자체에는 접속 인증과 TLS가 없습니다. 외부 접속은 VPN 또는 인증·TLS 프록시 등 기존 배포 구성에 맞춰 접근을 제한해야 합니다. 프록시 사용 시 WebSocket 업그레이드와 MJPEG의 실시간 스트리밍·버퍼링 해제를 지원해야 합니다.

## 9. HMI측 확인 순서

1. HMI PC에서 `/video`와 `/video/status`에 접속합니다. 설비 영상이 미연결이면 화면이 비어 있고 JSON의 `connected=false`인 것이 정상입니다.
2. 설비 담당이 카메라 1·2의 JPEG 업로드를 시작한 뒤 각 영상의 실제 카메라 위치와 id 대응을 확인합니다.
3. HMI에 iframe 또는 개별 MJPEG 주소를 연결하고 두 카메라가 갱신되는지 확인합니다.
4. 카메라 하나의 업로드만 5초 넘게 멈춰 해당 화면만 미수신 표시가 되는지, 재개 시 자동으로 복구되는지 확인합니다.
5. 영상 업로드 연결 종료 및 서버 재시작 후 이전 화면이 정상 영상처럼 남지 않는지, 재접속이 되는지 확인합니다.
6. 여러 HMI에서 동시 표시하고 영상 수신 중 XML Ping/Pong도 정상인지 확인합니다. 이 통신 확인에는 실제 장비를 움직이는 명령이 필요하지 않습니다.
7. 실제 해상도·FPS에서 지연과 CPU·네트워크 사용량을 측정합니다. 테스트용 JPEG 통신 검사는 실제 카메라 성능 보장이 아닙니다.

서버의 영상 중계는 테스트용 JPEG와 복수 HTTP 수신 클라이언트로 검사했습니다. 실제 HMI 프로젝트에 이 화면을 연결하는 작업과 실제 카메라를 이용한 표시·성능 확인은 양측 연동 시험에서 진행해야 합니다.
