const axios = require('axios');
const jwt = require('jsonwebtoken');

const UserService = require('./userService');
const groupSchema = require('../model/schema/groupSchema');

const crypto = require('crypto');
const { rejects } = require('assert');
const { resolve } = require('path');
const { assert } = require('console');
const log = console.log;

const enCrypted = (pw, salt) => {
  return crypto
    .createHash('sha512')
    .update(pw + salt)
    .digest('hex');
};

const useCrypto = (pw, adminPw) => {
  const salt = Math.round(new Date().valueOf() * Math.random()) + '';
  let encryptPw;
  if (pw === '') {
    encryptPw = {
      salt: salt,
      pw: '',
      adminPw: enCrypted(adminPw, salt),
    };
  } else {
    encryptPw = {
      salt: salt,
      pw: enCrypted(pw, salt),
      adminPw: enCrypted(adminPw, salt),
    };
  }
  return encryptPw;
};

const addMember = (group, accountId) => {
  group.members.push(accountId);
  group.membersNum += 1;
};

const removeMember = (group, accountId) => {
  group.members.splice(group.members.indexOf(accountId), 1);
  group.membersNum -= 1;
};

const codeMaker = async () => {
  const code = Math.random().toString(36).substr(2, 6);
  if (await codeIsZero(code)) {
    return code;
  } else {
    await codeMaker();
  }
};

const codeIsZero = async (code) => {
  const groupCnt = await groupSchema.countDocuments({ code: code });
  return groupCnt < 1;
};

module.exports.updateMemberList = async (groupName, updateList) => {
  try {
    const group = await groupSchema.findOne({
      name: groupName,
    });
    for (const item of updateList.addMember) {
      await addMember(group, item);
    }
    for (const item of updateList.removeMember) {
      await removeMember(group, item);
    }
    group.modifiedDate = Date.now();
    await group.save();
    return true;
  } catch (e) {
    throw new Error(e);
  }
};

module.exports.saveGroup = async (groupData) => {
  try {
    const { salt, pw, adminPw } = useCrypto(
      groupData.password,
      groupData.adminPassword
    );
    groupData.code = await codeMaker();
    groupData.salt = salt;
    groupData.password = pw;
    groupData.adminPassword = adminPw;
    const group = new groupSchema(groupData);
    await group.save();
    return groupData.code;
  } catch (e) {
    throw new Error(e);
  }
};

module.exports.updateGroupInfo = async ({
  name,
  code,
  open,
  password,
  adminPassword,
}) => {
  const group = await groupSchema.findOne({
    code: code,
  });
  const { salt, pw, adminPw } = useCrypto(password, adminPassword);
  group.name = name;
  group.code = code;
  group.open = open;
  group.password = pw;
  group.adminPassword = adminPw;
  group.salt = salt;
  group.modifiedDate = Date.now();
  group.save();
  return await groupSchema.findOne({
    code: code,
  });
};

module.exports.getGroup = async (code) => {
  const group = await groupSchema.findOne(
    {
      code: code,
    },
    {
      open: 1,
      members: 1,
      membersNum: 1,
      name: 1,
      code: 1,
      createdDate: 1,
      _id: 0,
    }
  );

  return group;
};

module.exports.deleteGroup = async (code) => {
  try {
    const group = await groupSchema.deleteOne({
      code: code,
    });
    return true;
  } catch (e) {
    return false;
  }
};

module.exports.searchGroup = async (keyword, page) => {
  try {
    const searchKeyword = new RegExp(keyword);
    const group = await groupSchema
      .find(
        { name: searchKeyword, open: true },
        { membersNum: 1, name: 1, code: 1, createdDate: 1, _id: 0 }
      )
      .sort({ createdDate: -1 })
      .skip((page - 1) * 10)
      .limit(10);
    return group;
  } catch (e) {
    console.log(e);
  }
};

module.exports.countSearchGroup = async (keyword) => {
  try {
    const searchKeyword = new RegExp(keyword);
    const group = await groupSchema.countDocuments({
      name: searchKeyword,
      open: true,
    });
    return group;
  } catch (e) {
    console.log(e);
  }
};

module.exports.authGroup = async (body) => {
  const group = await groupSchema.findOne({ code: body.code }).catch((err) => {
    throw new Error('group found fail');
  });
  const password = await enCrypted(body.password, group.salt);
  if (group.password === password) {
    return body.code;
  }
  throw new Error('login fail');
};

const getPayload = (code) => ({
  admin: true,
  code: code,
});

const setOption = (time, issuer, subject) => ({
  expiresIn: time,
  issuer: issuer,
  subject: subject,
});

const getToken = (payload, option) =>
  jwt.sign(payload, process.env.SECRET_KEY, option);

module.exports.adminAuthGroup = async (adminInfo) => {
  const group = await groupSchema
    .findOne({ code: adminInfo.code })
    .catch((err) => {
      throw new Error('login fail');
    });
  const password = await enCrypted(adminInfo.password, group.salt);
  if (group.adminPassword === password) {
    const payload = getPayload(group.code);
    const option = setOption('5h', 'flol', 'adminPassword');
    const token = getToken(payload, option);
    return token;
  }
  throw new Error('login fail');
};
