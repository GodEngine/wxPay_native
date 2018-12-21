const urllib = require('urllib')
const JsSHA = require('jssha')
const crypto = require('crypto')
// 调用微信的SDK
const appInfo = {
  appID: '',  // 公众号appid
  appsecret: '', // 公众号secret
  key: '', // md5秘钥
  mchId: 0, // 商户号
  completeCallback: '', // 用户扫码支付成功以后的微信的回调地址
  urlMap: { // 微信sdk
    authorize: 'https://open.weixin.qq.com/connect/oauth2/authorize',
    getticket: 'https://api.weixin.qq.com/cgi-bin/ticket/getticket',
    token: 'https://api.weixin.qq.com/cgi-bin/token',
    userinfo: 'https://api.weixin.qq.com/sns/userinfo',
    unifiedorder: 'https://api.mch.weixin.qq.com/pay/unifiedorder',
    oauth2: 'https://api.weixin.qq.com/sns/oauth2',
    jscode2session: 'https://api.weixin.qq.com/sns/jscode2session',
  },
}

const { urlMap } = appInfo
const requestConfig = {
  dataType: 'json',
  timeout: 2000,
}

// token缓存变量
const cacheInfo = {}

/**
 * 时间戳
 */
const timeStamp = () => parseInt(new Date().getTime() / 1000, 10)


const sign = ({ ticket, nonceStr, timestamp, url }) => {
  const str = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`
  const shaObj = new JsSHA(str, 'TEXT')

  return shaObj.getHash('SHA-1', 'HEX')
}

/**
 * 对数据进行md5加密
 */
const paySign = arg => {
  // 按照字典排序所有参数
  let str = Object.keys(arg).sort((a, b) => a === b ? 0: a > b ? 1 : -1).map(key => `${key}=${arg[key]}`).join('&')

  // 将key拼接在最后
  let stringSignTemp = `${str}&key=${appInfo.key}`

  let sign = (arg.signType || arg.sign_type) === 'HMAC-SHA256' ? /* HMAC-SHA256签名方式 */ hashMac(stringSignTemp):  /* MD5签名方式 */ md5(stringSignTemp)
  return sign.toUpperCase()
}

/**
 * 获取ticket
 * @param  {string}    accessToken 微信API的token（2h更新一次）
 */
async function getTicket (accessToken) {
  if (!cacheInfo.ticket || ((timeStamp() - 7200) > cacheInfo.ticketStartTime)) {
    try {
      const result = await urllib.request(`${urlMap.getticket}?access_token=${accessToken}&type=jsapi`, requestConfig)

      if (Number(result.status) !== 200) {
        console.error(`get ticket error:${JSON.stringify(result)}`)
        return null
      }
      const ticket = cacheInfo.ticket = result.data.ticket
      cacheInfo.ticketStartTime = timeStamp()
      return ticket
    } catch (e) {
      console.error(`${urlMap.getticket}:`, e.message)
      return null
    }
  } else {
    return cacheInfo.ticket
  }
}

/**
 * 获取签名
 * @param  {string}    url 请求接口的URL
 */
async function getWxSignature (url) {
  try {
    const result = await urllib.request(`${urlMap.token}?grant_type=client_credential&appid=${appInfo.appID}&secret=${appInfo.appsecret}`, requestConfig)

    if (Number(result.status) !== 200) {
      console.error(`get wx signature${JSON.stringify(result)}`)
      return null
    }

    const token = await getToken()

    const ticket = await getTicket(token)

    if (!ticket) {
      console.error(`get ticket info error:${token}`)
      return null
    }

    const nonceStr = Math.random().toString(36).substr(2, 15)
    const timestamp = timeStamp()
    const signature = sign({ ticket, nonceStr, timestamp, url })
    return { ticket, nonceStr, timestamp, url, signature, appId: appInfo.appID }
  } catch (e) {
    console.error(`${urlMap.token}?grant_type=client_credential`, e.message)
    return {
      code: 500,
      msg: e.message,
    }
  }
}

/**
 * 获取wx用户信息
 * @param  {string}    code wx跳转拼接的code参数
 */
async function getWxUserInfo ({ openid, accessToken }) {
  try {
    // 通过微信返回的code来获取用户的openID
    const configs = {
      dataType: 'json',
    }

    // 通过openID来获取用户基本信息

    const result = await urllib.request(`${urlMap.userinfo}?access_token=${accessToken}&openid=${openid}&lang=zh_CN`, configs)

    return result.data
  } catch (e) {
    console.log(e)
    return null
  }
}

/**
 * 获取token信息
 * 2h更新一次
 */
async function getToken () {
  if (!cacheInfo.token || ((timeStamp() - 7200) > cacheInfo.tokenStartTime)) {
    const result = await urllib.request(`${urlMap.token}?grant_type=client_credential&appid=${appInfo.appID}&secret=${appInfo.appsecret}`, requestConfig)

    if (Number(result.status) !== 200) {
      console.error(`get token error:${JSON.stringify(result)}`)
      return null
    }

    const token = cacheInfo.token = result.data.access_token
    cacheInfo.tokenStartTime = timeStamp()

    return token
  } else {
    return cacheInfo.token
  }
}

/**
 * 获取网页授权token以及openID
 * 不同于基础支持的access_token
*/
function* getOpenId (context) {
  // cookie中没有token，需要授权
  if (!context.cookies.get('WX_USER_INFO')) {
    return null
  } else {
    // cookie中存在信息，判断token是否有效
    const tokenData = JSON.parse(context.cookies.get('WX_USER_INFO'))

    return tokenData

    // // 获取验证token是否有效
    // let result = await urllib.request(`https://api.weixin.qq.com/sns/auth?access_token=${tokenData.access_token}&openid=${tokenData.openid}`, requestConfig)
    // // token过期了，通过refresh_token刷新，重新获取
    // if (Number(result.data.errcode) === 40003) {
    //   result = await urllib.request(`${urlMap.oauth2}/refresh_token?appid=${appInfo.appID}&grant_type=refresh_token&refresh_token=${tokenData.refresh_token}`, requestConfig)
    //
    //   // 表示refresh_token也过期了，需要重新授权
    //   if (Number(result.data.errcode) === 40029) {
    //     return null
    //   } else {
    //     // 更新cookie中的token信息
    //     context.cookies.set('WX_USER_INFO', JSON.stringify(result.data))
    //
    //     return result.data
    //   }
    // } else {
    //   // 有效token，直接返回
    //   return tokenData
    // }
  }
}

/**
 * 统一下单
 * @param {object} context koa context
 * @param {string} body 商品描述
 * @param {string} out_trade_no 订单号
 * @param {number} total_fee 订单金额
 * @param {string} openid wx用户id
  返回值结构: 
  { return_code: 'SUCCESS',
    return_msg: 'OK',
    appid: '',
    mch_id: '',
    device_info: 'WEB',
    nonce_str: 'SrCOdXJUnTqcHXx2',
    sign: '',
    result_code: 'SUCCESS',
    prepay_id: '',
    trade_type: 'NATIVE',
    code_url: ''
  }
 *
 */
async function createWxOrder (context, { total_fee, out_trade_no, body, openid }) {
  const { appID, mchId, completeCallback } = appInfo // 公众号和商户号
  const device_info = 'WEB' // 设备号
  const nonce_str = Math.random().toString(36).substr(2, 15) // 随机字符串
  const sign_type = 'MD5' // 签名加密方式
  const spbill_create_ip = context.request.ip.match(/\d+\.\d+\.\d+\.\d+/)[0] // 客户端IP
  const notify_url = completeCallback // 异步接受微信支付结果通知的回调地址
  const trade_type = 'NATIVE' // 交易类型

  const goodDescription = `服务title${body ? `-${body}` : ''}`
  // 将参数生成签名
  const sign = paySign({
    appid: appID,
    mch_id: mchId,
    device_info,
    nonce_str,
    body: goodDescription,
    sign_type,
    out_trade_no,
    spbill_create_ip,
    notify_url,
    trade_type,
    openid,
    total_fee,
  })

  // 签名+其余参数 生成xml
  const requestXML = stringifyXML({
    appid: appID,
    mch_id: mchId,
    device_info,
    nonce_str,
    body: goodDescription,
    sign_type,
    out_trade_no,
    spbill_create_ip,
    notify_url,
    trade_type,
    openid,
    total_fee,
    sign,
  })
  try {
    let result = await urllib.request(urlMap.unifiedorder, Object.assign({}, requestConfig, {
      method: 'POST',
      dataType: 'text',
      headers: {
        'Content-Type': 'text/xml',
      },
      data: requestXML,
    }))

    result = parseXMLOri(result.data)
    const {
      return_code,
      result_code,
    } = result

    if (return_code === 'SUCCESS' && result_code === 'SUCCESS') {
      return result
    }
    return null
  } catch (error) {
    return null
  }
}

/**
 * 将JSON转换为XML
 * @param  {Object} obj
 * @return {string}     xml string
 */
function stringifyXML (obj, root = 'xml') {
  return `<${root}>${Object.keys(obj).sort((a, b) => a === b ? 0 : a > b ? 1 : -1).map(key => `<${key}><![CDATA[${obj[key]}]]></${key}>`).join('')}</${root}>`
}

/**
 * 将微信传递的XML转换为JSON
 * @param  {string} xmlText xml string
 * @return {Object}
*/
function parseXMLOri (xmlText) {
  const obj = {}
  const matchs = xmlText.replace(/[\s\r\t]/g, '').replace(/<(.*?)>(.*?)<\/\1>/g, (_, $1, $2) => $2).match(/<(.*?)>(.*?)<\/\1>/g)

  if (!matchs) return null
  matchs.map(item => item.replace(/<(.*?)>(.*?)<\/\1>/g, (_, $1, $2) => {
    obj[$1] = formatVal($2)
  }))
  return obj
}

/**
 * 解析经过koa-xml-body中间件处理过的xml格式为object
 * @param {string} xmlBody koa-xml-body解析后的xml
 */
function parseXML (xmlBody) {
  if (!xmlBody) return null
  const { xml } = xmlBody
  const re = {}
  Object.keys(xml).forEach(key => {
    const [value] = xml[key]
    re[key] = value
  })
  return re
}

/**
 * 转换变量类型
 * @param  {string} val
 * @return {any}
 */
function formatVal (val) {
  val = val.replace(/<!\[CDATA\[(.*?)\]\]>/, (_, $1) => $1)
  if (/^true|false$/.test(val)) {
    return val === 'true'
  } else {
    return val
  }
}

/**
 * md5加密
 * @param {*} str 需要加密的字符串 
 */
function md5 (str) {
  return crypto.createHash('md5').update(str).digest('hex').toString('utf8')
}

/**
 * hashMac 签名
 * @param {*} str 需要加密的字符串 
 */
function hashMac (str) {
  const hash = crypto.createHmac('sha256', appInfo.key)
    .update(str)
    .digest('hex')
  return hash
}

/**
 * 微信参数签名校验工具
 * @param {*} args 加密参数
 * @param {*} signed 待验证的签名
 */
function checkSign(argObj) {
  const args = Object.assign({}, argObj)
  delete args.sign
  return paySign(args) === argObj.sign
}

module.exports = {
  getWxSignature,
  getWxUserInfo,
  getOpenId,
  createWxOrder,
  paySign,
  parseXML,
  stringifyXML,
  timeStamp,
  checkSign,
}
