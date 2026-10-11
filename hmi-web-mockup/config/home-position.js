// 원점(홈) 자세 — SO-100/101 로봇팔 6축 각도
// 실제 값은 로봇팔 캘리브레이션 후 채워야 합니다. 지금 값은 임시값입니다.
// 원점 잡기(F-04)를 누르면 이 값이 그대로 서버로 갑니다 (docs/API.md 3.2).
window.HMI_HOME_POSITION = {
  provisional: true, // 실제 값을 채우면 false로 바꾸세요
  joints: [
    { id: 'shoulder_pan', angle: 0, unit: '°' },
    { id: 'shoulder_lift', angle: 0, unit: '°' },
    { id: 'elbow_flex', angle: 0, unit: '°' },
    { id: 'wrist_flex', angle: 0, unit: '°' },
    { id: 'wrist_roll', angle: 0, unit: '°' },
    { id: 'gripper', angle: 0, unit: '%' },
  ],
};
