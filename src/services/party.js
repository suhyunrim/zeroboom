/**
 * 파티 개설
 * @param name 파티명
 * @param user 생성한 사람 이름
 * @param time 예상 시작 시간
 */
const create = async (name, user, time) => {
  return {
    name,
    user,
    time,
  };
};

exports.create = create;

/**
 * 파티 참가
 * @param name 파티명
 * @param user 참여할 사람 이름
 */
const join = (name, user) => {
  return {
    name,
    user,
  };
};

exports.join = join;

/**
 * 파티 초대
 * @description 초대된 사람에게 초대 여부와 참가 명령어를 알려주는 기능
 * @param name 파티명
 * @param user 초대한 사람 이름
 * @param guest 초대받은 사람 이름
 */
const invite = (name, user, guest) => {
  return {
    name,
    user,
    guest,
  };
};

exports.invite = invite;

/**
 * 파티 탈퇴
 * @param name 파티명
 * @param user 나간 사람 이름
 */
const exit = (name, user) => {
  return {
    name,
    user,
  };
};

exports.exit = exit;

/**
 * 파티 추방
 * @param name 파티명
 * @param user 생성한 사람 이름
 */
const kick = (name, user) => {
  return {
    name,
    user,
  };
};

exports.kick = kick;

/**
 * 파티 개설
 * @param name 파티명
 * @param user 추방한 사람 이름
 * @param guest 추방된 사람 이름
 */
const remove = (name, user, guest) => {
  return {
    name,
    user,
    guest,
  };
};

exports.remove = remove;

/**
 * 파티 만료
 * @description 시간 지나면 자동 삭제
 */
const expire = () => {
  return {};
};

exports.expire = expire;
