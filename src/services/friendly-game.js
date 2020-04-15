/**
 * 그룹 생성
 * @param name 그룹명
 */
const createGroup = async (name) => {
  return {
    name
  };
};

exports.createGroup = createGroup;

/**
 * 유저 등록
 * @param groupName 그룹명
 * @param nickname 유저 롤 닉네임
 * @param tier 유저 롤 티어
 */
const registerUser = (groupName, nickname, tier) => {
  return {
    groupName,
    nickname,
    tier
  };
};

exports.registerUser = registerUser;

/**
 * 내전 팀짜기
 * @param userList 유저 리스트
 */
const generateMatch = (userList) => {
  return {
    userList
  };
};

exports.generateMatch = generateMatch;