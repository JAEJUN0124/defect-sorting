// 원점(홈) 자세 — SO-101 로봇팔 6축 각도
// 실제 값은 로봇팔 캘리브레이션 후 채워야 합니다. 지금 값은 임시값입니다.
// 원점 잡기(F-04)를 누르면 이 값이 그대로 서버로 갑니다 (docs/API.md 4.2).
// 지금 로봇팔 자세를 읽어 이 값을 채우려면 tools/devices.html의 "로봇팔 서보" → "지금 자세를 원점값으로"를 쓰세요 (서버를 끈 상태에서).
window.HMI_HOME_POSITION = {
  provisional: true, // 실제 값을 채우면 false로 바꾸세요
  // 값의 단위 — 서버(LeRobot) 설정과 같아야 합니다
  //   'deg' = 관절은 도, 그리퍼는 0~100 (LeRobot 기본값 use_degrees=True)
  //   'norm' = 관절 -100~100, 그리퍼 0~100 (LeRobot use_degrees=False)
  unit: 'deg',
  joints: [
    { id: 'shoulder_pan', angle: 0 },
    { id: 'shoulder_lift', angle: 0 },
    { id: 'elbow_flex', angle: 0 },
    { id: 'wrist_flex', angle: 0 },
    { id: 'wrist_roll', angle: 0 },
    { id: 'gripper', angle: 0 },
  ],
};
