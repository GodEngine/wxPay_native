## 准备工作(以下设置需要超管权限)
#### 微信公众号设置
1. 超级管理员身份登录微信公众平台，获取到appid,appsecret。
2. 设置ip白名单，内容为服务所在的服务器ip地址，即允许该ip出发的请求访问到微信的api。

#### 微信商户号设置
1. 超级管理员身份登录微信商户平台，获取到mch_id商户号。
2. 在**产品中心**—>**开发配置**—>**支付配置**—>**扫码支付**处，添加支付回调地址，用户扫描付款二维码后，微信会以xml格式，post请求的方式请求该回调地址。
3. 在**账户中心**—>**账户设置**—>**API安全**—>**API密钥**处，设置签名秘钥，该秘钥跟代码中md5签名用的秘钥一致，用来进行签名校验。

#### 工具类库wxUtil.js
具体代码可参考wxUtil.js：

## 开发流程
1. 生成商品对应的支付二维码，生成过程中将加密的uid加在product_id值中。
2. 用户扫描支付二维码后，微信会调用在商户平台设置的支付回调接口地址，调用后接口需要向微信返回下面第7步的信息。
3. 回调接口用[koa-xml-body](https://github.com/creeperyang/koa-xml-body)或其他xmlparser中间件解析上一步微信传递过来的数据A。
4. 对数据A进行签名校验，若签名错误则以xml格式返回给微信return_code为'FAIL'值。
5. 签名通过，根据A中的product_id生成一笔状态为“未支付”的订单，订单信息包括唯一的订单号id，从product_id从解析出来的uid，应付款等信息。
6. 请求微信统一下单接口，参数中需要上步提供的唯一订单号，A中的openid，以及notify_url参数，用户支付成功后微信会调用notify_url通知支付信息。
7. 若请求统一下单接口成功，则会返回包含随机字符串nonce_str和预支付id prepay_id信息的数据，其中的code_url并没有什么卵用。此时，若之前操作都顺利，将return_code、appid、mch_id, nonce_str、prepay_id、result_code必要信息以xml格式返回给微信。其中return_code和result_code为“SUCCESS”或“FAIL”,nonce_str和prepay_id为第6步统一下单请求返回的数据中的信息。
8. 若以上返回信息正确，则用户支付完成后，notify_url预留的地址会受到微信的xml post请求，请求信息内会包含随机字符串nonce_str，实际支付金额cash_fee，微信支付流水号transaction_id等数据B。
9. 对数据进行签名校验以及金额校验。
10. 校验通过，修改数据库中订单状态。
11. 以xml格式返回给微信return_code为'SUCCESS'，nonce_str为步骤8收到的随机字符串。
12. 完

## note
- 生成二维码时，product_id可设置为加密后的"gid_uid"格式，以便后续获取到uid。
- md5加密时，过滤掉可能存在的falsy值，如空字符串，undefined，null等。
- xmlparser可能会与其他bodyparser冲突，导致中间件内部抛出异常。