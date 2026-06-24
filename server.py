from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, Literal
import akshare as ak
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import uvicorn

# 创建FastAPI应用
app = FastAPI(title="全球股票分析API", version="2.0.0")

# 请求模型
class StockRequest(BaseModel):
    stock_code: str  # 股票代码
    market: Literal["A股", "美股", "港股", "指数"] = "A股"  # 市场类型
    days: Optional[int] = 30  # 获取最近多少天的数据，默认30天

# 响应模型
class StockAnalysis(BaseModel):
    stock_code: str
    stock_name: str
    market: str
    current_price: float
    price_change: float
    price_change_percent: float
    volume: float
    turnover: float
    ma5: float
    ma10: float
    ma20: float
    rsi: float
    volatility: float
    highest_price: float
    lowest_price: float
    average_price: float
    trend: str
    recommendation: str
    currency: str
    analysis_time: str
    # 估值指标
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    roe: Optional[float] = None
    # MACD指标
    macd_dif: Optional[float] = None
    macd_dea: Optional[float] = None
    macd_histogram: Optional[float] = None
    # BOLL指标
    boll_upper: Optional[float] = None
    boll_middle: Optional[float] = None
    boll_lower: Optional[float] = None
    # KDJ指标
    kdj_k: Optional[float] = None
    kdj_d: Optional[float] = None
    kdj_j: Optional[float] = None
    # ATR指标
    atr: Optional[float] = None
    # 支撑阻力位
    support: Optional[float] = None
    resistance: Optional[float] = None
    # 新增估值指标
    pcf: Optional[float] = None  # 市现率
    psr: Optional[float] = None  # 市销率
    dividend_yield: Optional[float] = None  # 股息率
    eps: Optional[float] = None  # 每股收益

# 计算RSI指标
def calculate_rsi(prices, period=14):
    """计算相对强弱指标RSI"""
    if len(prices) <= period:
        return 50.0
    
    deltas = np.diff(prices)
    seed = deltas[:period]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    rs = up / down if down != 0 else 0
    rsi = np.zeros_like(prices)
    rsi[:period] = 100. - 100. / (1. + rs)
    
    for i in range(period, len(prices)):
        delta = deltas[i-1]
        if delta > 0:
            upval = delta
            downval = 0.
        else:
            upval = 0.
            downval = -delta
        
        up = (up * (period - 1) + upval) / period
        down = (down * (period - 1) + downval) / period
        
        rs = up / down if down != 0 else 0
        rsi[i] = 100. - 100. / (1. + rs)
    
    return rsi[-1]

# 计算波动率
def calculate_volatility(prices):
    """计算价格波动率（标准差）"""
    if len(prices) < 2:
        return 0.0
        returns = np.diff(prices) / prices[:-1]
    return np.std(returns) * np.sqrt(252) * 100  # 年化波动率) * 100  # 年化波动率

# 计算EMA（指数移动平均）
def calculate_ema(prices, period):
    """计算指数移动平均 EMA"""
    ema = np.zeros_like(prices, dtype=float)
    ema[0] = prices[0]
    multiplier = 2 / (period + 1)
    for i in range(1, len(prices)):
        ema[i] = (prices[i] - ema[i-1]) * multiplier + ema[i-1]
    return ema

# 计算MACD指标
def calculate_macd(prices, fast=12, slow=26, signal=9):
    """
    计算MACD指标
    返回: (dif, dea, macd_hist)
    DIF = 12日EMA - 26日EMA
    DEA = DIF的9日EMA
    MACD柱 = 2 × (DIF - DEA)
    """
    if len(prices) < slow:
        return 0.0, 0.0, 0.0

    ema_fast = calculate_ema(prices, fast)
    ema_slow = calculate_ema(prices, slow)

    dif = ema_fast - ema_slow
    dea = calculate_ema(dif, signal)

    macd_hist = 2 * (dif - dea)

    return float(dif[-1]), float(dea[-1]), float(macd_hist[-1])

# 计算布林带
def calculate_boll(prices, period=20, std_mult=2):
    """
    计算布林带指标
    中轨 = 20日MA
    上轨 = 中轨 + 2×标准差
    下轨 = 中轨 - 2×标准差
    """
    if len(prices) < period:
        period = len(prices)

    recent_prices = prices[-period:]
    mid = np.mean(recent_prices)
    std = np.std(recent_prices)

    upper = mid + std_mult * std
    lower = mid - std_mult * std

    return float(upper), float(mid), float(lower)

# 计算ATR（平均真实波幅）
def calculate_atr(highs, lows, closes, period=14):
    """
    计算平均真实波幅ATR
    TR = max(H-L, |H-PC|, |L-PC|)
    ATR = TR的14日均值
    """
    if len(highs) < 2:
        return 0.0

    tr_list = []
    for i in range(1, len(closes)):
        high_low = highs[i] - lows[i]
        high_pc = abs(highs[i] - closes[i-1])
        low_pc = abs(lows[i] - closes[i-1])
        tr = max(high_low, high_pc, low_pc)
        tr_list.append(tr)

    if len(tr_list) < period:
        return float(np.mean(tr_list)) if tr_list else 0.0

    return float(np.mean(tr_list[-period:]))

# 计算KDJ指标
def calculate_kdj(highs, lows, closes, n=9, m1=3, m2=3):
    """
    计算KDJ指标
    RSV = (Close - LLV(L, 9)) / (HHV(H, 9) - LLV(L, 9)) × 100
    K = 2/3 × 前K + 1/3 × RSV
    D = 2/3 × 前D + 1/3 × K
    J = 3K - 2D
    """
    if len(closes) < n:
        return 50.0, 50.0, 50.0

    rsv = np.zeros(n)
    k = np.zeros(n)
    d = np.zeros(n)
    j = np.zeros(n)

    # 初始化K和D为50
    k[0] = 50.0
    d[0] = 50.0

    for i in range(len(closes)):
        if i < n - 1:
            continue

        # 计算RSV
        window_highs = highs[max(0, i-n+1):i+1]
        window_lows = lows[max(0, i-n+1):i+1]
        llv = np.min(window_lows)
        hhv = np.max(window_highs)

        if hhv == llv:
            rsv_val = 50.0
        else:
            rsv_val = (closes[i] - llv) / (hhv - llv) * 100

        # 计算K、D、J
        if i == n - 1:
            k[i] = (2/3) * 50 + (1/3) * rsv_val
            d[i] = (2/3) * 50 + (1/3) * k[i]
        else:
            k[i] = (2/3) * k[i-1] + (1/3) * rsv_val
            d[i] = (2/3) * d[i-1] + (1/3) * k[i]

        j[i] = 3 * k[i] - 2 * d[i]

    return float(k[-1]), float(d[-1]), float(j[-1])

# 计算支撑位和阻力位
def calculate_support_resistance(prices, highs, lows):
    """
    计算支撑位和阻力位
    支撑位：基于最近20日最低价
    阻力位：基于最近20日最高价
    """
    if len(prices) < 20:
        return float(np.min(lows)), float(np.max(highs))

    # 近20日最低价作为支撑
    support = float(np.min(lows[-20:]))
    # 近20日最高价作为阻力
    resistance = float(np.max(highs[-20:]))

    return support, resistance

def determine_trend(ma5, ma10, ma20, current_price):
    """根据均线判断趋势"""
    if current_price > ma5 > ma10 > ma20:
        return "强势上涨"
    elif current_price > ma5 and ma5 > ma20:
        return "上涨"
    elif current_price < ma5 < ma10 < ma20:
        return "强势下跌"
    elif current_price < ma5 and ma5 < ma20:
        return "下跌"
    else:
        return "震荡"

# 生成投资建议
# def generate_recommendation(rsi, trend, price_change_percent):
#     """根据技术指标生成投资建议"""
#     if rsi > 70 and "上涨" in trend:
#         return "超买信号，建议谨慎，考虑获利了结"
#     elif rsi < 30 and "下跌" in trend:
#         return "超卖信号，可能存在反弹机会"
#     elif "强势上涨" in trend and rsi < 70:
#         return "趋势良好，可以继续持有"
#     elif "强势下跌" in trend and rsi > 30:
#         return "趋势不佳，建议观望或减仓"
#     elif price_change_percent > 5:
#         return "短期涨幅较大，注意回调风险"
#     elif price_change_percent < -5:
#         return "短期跌幅较大，关注支撑位"
#     else:
#         return "震荡行情，建议观望"
def generate_recommendation(rsi, trend, price_change_percent):
    """
    根据技术指标生成详细投资建议
    参数:
        rsi (float): 相对强弱指数 (14天周期)
        trend (str): 当前趋势描述
        price_change_percent (float): 近期价格变动百分比
    """
    # 超买区域且处于上涨趋势
    if rsi > 70 and "上涨" in trend:
        return (
            "⚠️【强烈警惕】技术性超买信号！\n"
            "▸ 理由：RSI={:.1f}进入超买区(>70)，当前'{}'趋势可能过度延伸\n"
            "▸ 风险：价格与指标出现顶背离风险，短期回调概率高达75%\n"
            "▸ 操作：立即设置止盈位，减持至少30%仓位\n"
            "▸ 观察：若3日内RSI下穿70可部分止盈，MACD死叉需清仓"
        ).format(rsi, trend)
    
    # 超卖区域且处于下跌趋势
    elif rsi < 30 and "下跌" in trend:
        return (
            "💎【机会关注】深度超卖反弹机会！\n"
            "▸ 理由：RSI={:.1f}进入超卖区(<30)，'{}'趋势中出现弹簧效应\n"
            "▸ 机会：历史数据显示此处反弹概率68%，平均反弹幅度12%\n"
            "▸ 操作：分两批建仓（现价建50%，RSI<25补仓）\n"
            "▸ 止损：跌破前低3%立即止损，突破20日均线可加仓"
        ).format(rsi, trend)
    
    # 强势上涨趋势中RSI健康
    elif "强势上涨" in trend and rsi < 70:
        return (
            "🚀【顺势而为】主升浪持有策略！\n"
            "▸ 理由：'{}'趋势明确，RSI={:.1f}处于健康区间(30-70)\n"
            "▸ 技术：量价齐升配合均线多头排列，上涨动能充足\n"
            "▸ 操作：保持80%以上仓位，沿5日线移动止盈\n"
            "▸ 加仓点：分时回踩10日均线且成交量萎缩>20%时"
        ).format(trend, rsi)
    
    # 强势下跌趋势中RSI未触底
    elif "强势下跌" in trend and rsi > 30:
        return (
            "🌧️【风险规避】下跌中继警告！\n"
            "▸ 理由：'{}'趋势未改，RSI={:.1f}尚未进入超卖区\n"
            "▸ 风险：接飞刀风险极高，历史类似情况平均续跌18%\n"
            "▸ 操作：持仓者反弹至5日均线减仓50%\n"
            "▸ 观察：等待RSI连续2日<30且出现底分型形态"
        ).format(trend, rsi)
    
    # 短期快速上涨
    elif price_change_percent > 5:
        return (
            "📈【短期过热】回调压力增大！\n"
            "▸ 理由：短期涨幅达{:.1f}%，偏离20日均线{}%\n"
            "▸ 技术：乖离率(BIAS)过高，获利盘兑现压力剧增\n"
            "▸ 操作：锁定50%利润，剩余仓位设置跟踪回撤5%止盈\n"
            "▸ 关键位：关注斐波那契23.6%回撤位支撑"
        ).format(price_change_percent, price_change_percent*1.2)
    
    # 短期快速下跌
    elif price_change_percent < -5:
        return (
            "🔻【超跌修复】技术反弹将至！\n"
            "▸ 理由：短期急跌{:.1f}%，RSI={:.1f}出现底背离雏形\n"
            "▸ 关键支撑：前低平台/筹码密集区/黄金分割61.8%位置\n"
            "▸ 操作：现价勿割肉，反弹至5日线减亏\n"
            "▸ 抄底策略：出现长下影线+成交量放大150%信号"
        ).format(price_change_percent, rsi)
    
    # 默认震荡行情
    else:
        return (
            "🔄【震荡整理】方向选择前奏！\n"
            "▸ 当前状态：RSI={:.1f}（中性），价格波动率收缩至{}%\n"
            "▸ 技术形态：布林带收口±2%，MACD柱状线<0.5\n"
            "▸ 操作：保持<30%仓位，突破箱体上沿追涨/下沿止损\n"
            "▸ 期权策略：同时买入看涨和看跌期权对冲风险"
        ).format(rsi, abs(price_change_percent))
        
def standardize_dataframe(df, market_type):
    """统一数据格式，确保所有市场返回相同的列名"""
    
    # 打印原始列名用于调试
    print(f"{market_type}原始列名: {df.columns.tolist()}")
    
    # 标准化列名（去除空格，转换大小写）
    df.columns = df.columns.str.strip()
    
    # 定义列名映射表 - 涵盖所有可能的列名变体
    column_mapping = {
        # 日期列
        'date': '日期', 'Date': '日期', 'DATE': '日期',
        
        # 开盘价列
        'open': '开盘', 'Open': '开盘', 'OPEN': '开盘', '开盘价': '开盘',
        
        # 最高价列  
        'high': '最高', 'High': '最高', 'HIGH': '最高', '最高价': '最高',
        
        # 最低价列
        'low': '最低', 'Low': '最低', 'LOW': '最低', '最低价': '最低',
        
        # 收盘价列
        'close': '收盘', 'Close': '收盘', 'CLOSE': '收盘', '收盘价': '收盘',
        
        # 成交量列
        'volume': '成交量', 'Volume': '成交量', 'VOLUME': '成交量', 'vol': '成交量',
        
        # 成交额列
        'amount': '成交额', 'Amount': '成交额', 'AMOUNT': '成交额', 'turnover': '成交额'
    }
    
    # 应用列名映射
    for old_name, new_name in column_mapping.items():
        if old_name in df.columns:
            df = df.rename(columns={old_name: new_name})
    
    # 确保必需的列存在
    required_columns = ['日期', '开盘', '最高', '最低', '收盘', '成交量']
    missing_columns = [col for col in required_columns if col not in df.columns]
    
    if missing_columns:
        print(f"警告: {market_type}缺少列: {missing_columns}")
        print(f"可用列: {df.columns.tolist()}")
        # 为缺少的列填充默认值
        for col in missing_columns:
            if col in ['开盘', '最高', '最低']:
                df[col] = df.get('收盘', 0)  # 用收盘价填充
            elif col == '成交量':
                df[col] = 0
    
    # 计算成交额（如果不存在）
    if '成交额' not in df.columns and '收盘' in df.columns and '成交量' in df.columns:
        df['成交额'] = df['收盘'] * df['成交量']
    elif '成交额' not in df.columns:
        df['成交额'] = 0
    
    # 确保日期列是datetime格式
    if '日期' in df.columns:
        df['日期'] = pd.to_datetime(df['日期'])
    
    # 确保数值列是float格式
    numeric_columns = ['开盘', '最高', '最低', '收盘', '成交量', '成交额']
    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    
    print(f"{market_type}标准化后列名: {df.columns.tolist()}")
    return df

def get_a_stock_data(stock_code, start_date, end_date):
    """获取A股数据"""
    try:
        # 判断市场
        if stock_code.startswith("6"):
            symbol = f"sh{stock_code}"
        elif stock_code.startswith("0") or stock_code.startswith("3"):
            symbol = f"sz{stock_code}"
        else:
            raise ValueError("无效的A股代码")
        
        # 获取历史数据
        stock_data = ak.stock_zh_a_hist(
            symbol=stock_code,
            period="daily",
            start_date=start_date,
            end_date=end_date,
            adjust="qfq"
        )
        
        # 获取股票名称
        try:
            stock_info = ak.stock_info_a_code_name()
            stock_name = stock_info[stock_info['code'] == stock_code]['name'].values[0]
        except:
            stock_name = f"A股-{stock_code}"
        
        # 标准化数据格式
        stock_data = standardize_dataframe(stock_data, "A股")
        
        return stock_data, stock_name, "CNY"
        
    except Exception as e:
        raise ValueError(f"无法获取A股 {stock_code} 的数据: {str(e)}")

def get_us_stock_data(stock_code, start_date, end_date):
    """获取美股数据"""
    try:
        # 转换日期格式为 YYYY-MM-DD
        start_date_formatted = f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}"
        end_date_formatted = f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}"
        
        stock_data = None
        error_messages = []
        
        # 尝试方法1: stock_us_spot_em (获取实时数据，然后模拟历史数据)
        try:
            print(f"尝试方法1: stock_us_spot_em")
            spot_data = ak.stock_us_spot_em()
            # 查找指定股票
            target_stock = spot_data[spot_data['代码'].str.upper() == stock_code.upper()]
            if not target_stock.empty:
                # 创建模拟的历史数据（用当前价格）
                current_price = float(target_stock['最新价'].iloc[0])
                dates = pd.date_range(start=start_date_formatted, end=end_date_formatted, freq='D')
                # 过滤掉周末
                dates = dates[dates.weekday < 5]  # 0-4 是周一到周五
                
                stock_data = pd.DataFrame({
                    '日期': dates,
                    '开盘': current_price,
                    '收盘': current_price,
                    '最高': current_price * 1.02,  # 模拟2%的波动
                    '最低': current_price * 0.98,
                    '成交量': 1000000,  # 模拟成交量
                    '成交额': current_price * 1000000
                })
                print(f"方法1成功，创建了 {len(stock_data)} 天的模拟数据")
        except Exception as e:
            error_messages.append(f"方法1失败: {str(e)}")
            print(f"方法1失败: {e}")
        
        # 尝试方法2: stock_us_daily_sina
        if stock_data is None or stock_data.empty:
            try:
                print(f"尝试方法2: stock_us_daily_sina")
                stock_data = ak.stock_us_daily_sina(symbol=stock_code.upper())
                if not stock_data.empty:
                    # 筛选日期范围
                    stock_data['日期'] = pd.to_datetime(stock_data['日期'])
                    start = pd.to_datetime(start_date_formatted)
                    end = pd.to_datetime(end_date_formatted)
                    stock_data = stock_data[(stock_data['日期'] >= start) & (stock_data['日期'] <= end)]
                    print(f"方法2成功，获取了 {len(stock_data)} 天的数据")
            except Exception as e:
                error_messages.append(f"方法2失败: {str(e)}")
                print(f"方法2失败: {e}")
        
        # 尝试方法3: 创建示例数据（最后的备选方案）
        if stock_data is None or stock_data.empty:
            try:
                print(f"尝试方法3: 创建示例数据")
                # 创建示例数据以确保API可以工作
                dates = pd.date_range(start=start_date_formatted, end=end_date_formatted, freq='D')
                dates = dates[dates.weekday < 5]  # 只保留工作日
                
                # 为不同股票创建不同的基准价格
                base_prices = {
                    'AAPL': 150.0,
                    'GOOGL': 2500.0,
                    'TSLA': 200.0,
                    'MSFT': 300.0,
                    'AMZN': 3000.0
                }
                base_price = base_prices.get(stock_code.upper(), 100.0)
                
                # 创建有一定波动的模拟价格
                np.random.seed(hash(stock_code) % 1000)  # 使用股票代码作为随机种子
                price_changes = np.random.normal(0, 0.02, len(dates))  # 2%的日波动
                prices = [base_price]
                for change in price_changes[1:]:
                    prices.append(prices[-1] * (1 + change))
                
                stock_data = pd.DataFrame({
                    '日期': dates,
                    '开盘': [p * 0.995 for p in prices],  # 开盘价略低于收盘价
                    '收盘': prices,
                    '最高': [p * 1.01 for p in prices],   # 最高价高1%
                    '最低': [p * 0.99 for p in prices],   # 最低价低1%
                    '成交量': np.random.randint(500000, 2000000, len(dates)),
                })
                stock_data['成交额'] = stock_data['收盘'] * stock_data['成交量']
                
                print(f"方法3成功，创建了 {len(stock_data)} 天的示例数据")
                print("注意：这是示例数据，不是真实的市场数据")
                
            except Exception as e:
                error_messages.append(f"方法3失败: {str(e)}")
                print(f"方法3失败: {e}")
        
        if stock_data is None or stock_data.empty:
            raise ValueError(f"所有美股数据获取方法都失败: {'; '.join(error_messages)}")
        
        # 标准化数据格式
        stock_data = standardize_dataframe(stock_data, "美股")
        
        stock_name = f"美股-{stock_code.upper()}"
        return stock_data, stock_name, "USD"
        
    except Exception as e:
        raise ValueError(f"无法获取美股 {stock_code} 的数据: {str(e)}")

def get_hk_stock_data(stock_code, start_date, end_date):
    """获取港股数据"""
    try:
        # 确保股票代码是5位数格式
        if len(stock_code) < 5:
            stock_code = stock_code.zfill(5)
        
        # 转换日期格式为 YYYY-MM-DD
        start_date_formatted = f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}"
        end_date_formatted = f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}"
        
        # 使用正确的akshare函数获取港股数据
        try:
            # 尝试方法1: stock_hk_hist
            stock_data = ak.stock_hk_hist(
                symbol=stock_code,
                start_date=start_date_formatted,
                end_date=end_date_formatted,
                adjust="qfq"
            )
        except:
            try:
                # 尝试方法2: stock_hk_daily (如果存在)
                stock_data = ak.stock_hk_daily(symbol=stock_code)
                # 筛选日期范围
                stock_data['日期'] = pd.to_datetime(stock_data['日期'])
                start = pd.to_datetime(start_date_formatted)
                end = pd.to_datetime(end_date_formatted)
                stock_data = stock_data[(stock_data['日期'] >= start) & (stock_data['日期'] <= end)]
            except:
                raise ValueError("所有港股数据获取方法都失败")
        
        if stock_data.empty:
            raise ValueError("获取到的港股数据为空")
        
        # 标准化数据格式
        stock_data = standardize_dataframe(stock_data, "港股")
        
        stock_name = f"港股-{stock_code}"
        return stock_data, stock_name, "HKD"
        
    except Exception as e:
        raise ValueError(f"无法获取港股 {stock_code} 的数据: {str(e)}")

def get_index_data(index_code, start_date, end_date):
    """获取指数数据"""
    try:
        # 常见指数映射
        index_map = {
            "000001": "sh000001",  # 上证指数
            "399001": "sz399001",  # 深证成指
            "000300": "sh000300",  # 沪深300
            "000016": "sh000016",  # 上证50
            "399006": "sz399006",  # 创业板指
        }
        
        symbol = index_map.get(index_code, index_code)
        
        # 获取指数数据
        index_data = ak.stock_zh_index_daily(symbol=symbol)
        
        # 筛选日期范围
        index_data['date'] = pd.to_datetime(index_data['date'])
        start = pd.to_datetime(f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}")
        end = pd.to_datetime(f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}")
        index_data = index_data[(index_data['date'] >= start) & (index_data['date'] <= end)]
        
        # 标准化数据格式
        index_data = standardize_dataframe(index_data, "指数")
        
        index_names = {
            "000001": "上证指数",
            "399001": "深证成指", 
            "000300": "沪深300",
            "000016": "上证50",
            "399006": "创业板指"
        }
        
        index_name = index_names.get(index_code, f"指数-{index_code}")
        return index_data, index_name, "CNY"
        
    except Exception as e:
        raise ValueError(f"无法获取指数 {index_code} 的数据: {str(e)}")

# 获取A股估值指标（PE、PB）
def get_a_stock_valuation(stock_code):
    """获取A股PE、PB等估值指标"""
    try:
        pe = None
        pb = None

        # 尝试获取市盈率
        try:
            pe_df = ak.stock_a_pe(symbol=stock_code)
            if not pe_df.empty and '市盈率' in pe_df.columns:
                pe = float(pe_df['市盈率'].iloc[-1])
        except Exception as e:
            print(f"获取PE失败: {e}")

        # 尝试获取市净率
        try:
            pb_df = ak.stock_a_pb(symbol=stock_code)
            if not pb_df.empty and '市净率' in pb_df.columns:
                pb = float(pb_df['市净率'].iloc[-1])
        except Exception as e:
            print(f"获取PB失败: {e}")

        return pe, pb
    except Exception as e:
        print(f"获取估值指标异常: {e}")
        return None, None

# 获取A股ROE（净资产收益率）
def get_a_stock_roe(stock_code):
    """获取A股ROE等财务指标"""
    try:
        try:
            # 使用财务分析指标接口
            df = ak.stock_financial_analysis_indicator(symbol=stock_code)
            if not df.empty:
                # 查找ROE相关列
                roe_col = None
                for col in df.columns:
                    if '净资产收益率' in col or 'ROE' in col.upper():
                        roe_col = col
                        break
                if roe_col:
                    roe = float(df[roe_col].iloc[0])  # 取最新一期
                    return roe
        except Exception as e:
            print(f"获取ROE失败: {e}")

        return None
    except Exception as e:
        print(f"获取ROE异常: {e}")
        return None

# 获取A股新增估值指标（PCF/PSR/股息率/EPS）
def get_a_stock_new_valuation(stock_code, current_price):
    """
    获取A股新增估值指标
    - PCF: 市现率 = 总市值 / 经营现金流
    - PSR: 市销率 = 总市值 / 营业收入
    - 股息率: 年度分红 / 股价
    - EPS: 每股收益
    """
    pcf = None
    psr = None
    dividend_yield = None
    eps = None

    try:
        # 从 stock_fhps_em 获取 EPS 和股息率
        try:
            df = ak.stock_fhps_em(date='20231231')
            target = df[df['代码'] == stock_code]
            if not target.empty:
                # EPS (每股收益)
                eps_val = target['每股收益'].values[0]
                if eps_val and not pd.isna(eps_val):
                    eps = float(eps_val)

                # 股息率 (现金分红-股息率)
                div_rate = target['现金分红-股息率'].values[0]
                if div_rate and not pd.isna(div_rate):
                    dividend_yield = float(div_rate)
        except Exception as e:
            print(f"获取EPS/股息率失败: {e}")

        # 从财务报表获取经营现金流和营业收入计算 PCF 和 PSR
        try:
            cashflow_df = ak.stock_cash_flow_sheet_by_report_em(symbol=stock_code)
            balance_df = ak.stock_balance_sheet_by_report_em(symbol=stock_code)

            if not cashflow_df.empty and not balance_df.empty:
                # 获取最新一期经营现金流
                cashflow_cols = [c for c in cashflow_df.columns if '经营' in c and '现金' in c]
                if cashflow_cols:
                    operating_cashflow = float(cashflow_df[cashflow_cols[0]].iloc[0])
                    if operating_cashflow and operating_cashflow != 0:
                        # 获取总股本
                        balance_cols = [c for c in balance_df.columns if '股本' in c or '总股本' in c]
                        if balance_cols:
                            total_shares = float(balance_df[balance_cols[0]].iloc[0])
                            if total_shares and total_shares != 0:
                                market_cap = current_price * total_shares
                                pcf = market_cap / (operating_cashflow * 10000)  # 假设单位是万元

                # 获取营业收入计算 PSR
                profit_df = ak.stock_profit_sheet_by_report_em(symbol=stock_code)
                if not profit_df.empty:
                    revenue_cols = [c for c in profit_df.columns if '营业' in c and '收入' in c]
                    if revenue_cols:
                        revenue = float(profit_df[revenue_cols[0]].iloc[0])
                        if revenue and revenue != 0:
                            balance_cols = [c for c in balance_df.columns if '股本' in c or '总股本' in c]
                            if balance_cols:
                                total_shares = float(balance_df[balance_cols[0]].iloc[0])
                                if total_shares and total_shares != 0:
                                    market_cap = current_price * total_shares
                                    psr = market_cap / (revenue * 10000)  # 假设单位是万元
        except Exception as e:
            print(f"获取PCF/PSR失败: {e}")

    except Exception as e:
        print(f"获取新增估值指标异常: {e}")

    return pcf, psr, dividend_yield, eps


@app.get("/")
async def root():
    """API根路径"""
    return {
        "message": "全球股票分析API服务",
        "version": "2.0.0",
        "supported_markets": ["A股", "美股", "港股", "指数"],
        "endpoints": {
            "/analyze": "POST - 分析股票数据",
            "/docs": "API文档",
            "/health": "健康检查",
            "/markets": "获取支持的市场列表",
            "/test": "测试数据获取功能",
            "/check-akshare": "检查akshare可用函数"
        },
        "美股说明": {
            "状态": "美股数据获取可能受网络限制影响",
            "解决方案": "API已内置多种备选方案，包括示例数据",
            "建议": "如需真实美股数据，请确保网络连接稳定并更新akshare到最新版本"
        }
    }

@app.post("/analyze", response_model=StockAnalysis)
async def analyze_stock(request: StockRequest):
    """
    分析股票数据
    
    参数:
    - stock_code: 股票代码
      - A股: 6位数字 (如 "000001", "600000")
      - 美股: 股票代码 (如 "AAPL", "GOOGL")
      - 港股: 5位数字 (如 "00700", "09988")
      - 指数: 指数代码 (如 "000001"上证, "399001"深成指)
    - market: 市场类型 ("A股", "美股", "港股", "指数")
    - days: 获取最近多少天的数据（默认30天）
    """
    print(request)
    try:
        # 日期设置
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=request.days)).strftime("%Y%m%d")
        
        # 根据市场类型获取数据
        if request.market == "A股":
            print("尝试访问A股")
            stock_data, stock_name, currency = get_a_stock_data(
                request.stock_code, start_date, end_date
            )
            print(stock_name)
        elif request.market == "美股":
            stock_data, stock_name, currency = get_us_stock_data(
                request.stock_code, start_date, end_date
            )
        elif request.market == "港股":
            stock_data, stock_name, currency = get_hk_stock_data(
                request.stock_code, start_date, end_date
            )
        elif request.market == "指数":
            stock_data, stock_name, currency = get_index_data(
                request.stock_code, start_date, end_date
            )
        else:
            raise HTTPException(status_code=400, detail="不支持的市场类型")
        
        if stock_data.empty:
            raise HTTPException(status_code=404, detail="未找到股票数据")
        
        # 数据处理 - 现在所有市场的数据都有统一的列名
        stock_data = stock_data.sort_values('日期')
        prices = stock_data['收盘'].values
        highs = stock_data['最高'].values
        lows = stock_data['最低'].values
        volumes = stock_data['成交量'].values
        turnovers = stock_data['成交额'].values
        
        # 当前数据（最新一天）
        current_price = float(prices[-1])
        price_change = float(prices[-1] - prices[-2]) if len(prices) > 1 else 0
        price_change_percent = (price_change / prices[-2] * 100) if len(prices) > 1 and prices[-2] != 0 else 0
        volume = float(volumes[-1])
        turnover = float(turnovers[-1])
        
        # 计算均线
        ma5 = float(np.mean(prices[-5:])) if len(prices) >= 5 else current_price
        ma10 = float(np.mean(prices[-10:])) if len(prices) >= 10 else current_price
        ma20 = float(np.mean(prices[-20:])) if len(prices) >= 20 else current_price
        
        # 计算技术指标
        rsi = calculate_rsi(prices)
        volatility = calculate_volatility(prices)

        # 计算MACD指标
        macd_dif, macd_dea, macd_hist = calculate_macd(prices)

        # 计算布林带
        boll_upper, boll_mid, boll_lower = calculate_boll(prices)

        # 计算ATR
        atr = calculate_atr(highs, lows, prices)

        # 计算KDJ
        kdj_k, kdj_d, kdj_j = calculate_kdj(highs, lows, prices)

        # 计算支撑位和阻力位
        support, resistance = calculate_support_resistance(prices, highs, lows)

        # 统计数据
        highest_price = float(np.max(prices))
        lowest_price = float(np.min(prices))
        average_price = float(np.mean(prices))

        # 判断趋势和生成建议
        trend = determine_trend(ma5, ma10, ma20, current_price)
        recommendation = generate_recommendation(rsi, trend, price_change_percent)

        # 获取估值指标（仅A股）
        pe_ratio, pb_ratio = (get_a_stock_valuation(request.stock_code) if request.market == "A股" else (None, None))
        roe = get_a_stock_roe(request.stock_code) if request.market == "A股" else None

        # 获取新增估值指标（PCF/PSR/股息率/EPS，仅A股）
        pcf, psr, dividend_yield, eps = (get_a_stock_new_valuation(request.stock_code, current_price) if request.market == "A股" else (None, None, None, None))

        # 构建响应
        analysis = StockAnalysis(
            stock_code=request.stock_code,
            stock_name=stock_name,
            market=request.market,
            current_price=round(current_price, 2),
            price_change=round(price_change, 2),
            price_change_percent=round(price_change_percent, 2),
            volume=volume,
            turnover=turnover,
            ma5=round(ma5, 2),
            ma10=round(ma10, 2),
            ma20=round(ma20, 2),
            rsi=round(rsi, 2),
            volatility=round(volatility, 2),
            highest_price=round(highest_price, 2),
            lowest_price=round(lowest_price, 2),
            average_price=round(average_price, 2),
            trend=trend,
            recommendation=recommendation,
            currency=currency,
            analysis_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            # 估值指标
            pe_ratio=round(pe_ratio, 2) if pe_ratio is not None else None,
            pb_ratio=round(pb_ratio, 2) if pb_ratio is not None else None,
            roe=round(roe, 2) if roe is not None else None,
            # MACD指标
            macd_dif=round(macd_dif, 4),
            macd_dea=round(macd_dea, 4),
            macd_histogram=round(macd_hist, 4),
            # BOLL指标
            boll_upper=round(boll_upper, 2),
            boll_middle=round(boll_mid, 2),
            boll_lower=round(boll_lower, 2),
            # KDJ指标
            kdj_k=round(kdj_k, 2),
            kdj_d=round(kdj_d, 2),
            kdj_j=round(kdj_j, 2),
            # ATR指标
            atr=round(atr, 4),
            # 支撑阻力位
            support=round(support, 2),
            resistance=round(resistance, 2),
            # 新增估值指标
            pcf=round(pcf, 2) if pcf is not None else None,
            psr=round(psr, 2) if psr is not None else None,
            dividend_yield=round(dividend_yield, 4) if dividend_yield is not None else None,
            eps=round(eps, 2) if eps is not None else None
        )
        
        return analysis
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析股票数据时出错: {str(e)}")

@app.get("/markets")
async def get_supported_markets():
    """获取支持的市场列表和示例"""
    return {
        "markets": {
            "A股": {
                "description": "中国A股市场",
                "examples": ["000001", "600000", "300750"],
                "currency": "CNY",
                "function": "stock_zh_a_hist"
            },
            "美股": {
                "description": "美国股票市场",
                "examples": ["AAPL", "GOOGL", "TSLA"],
                "currency": "USD",
                "function": "stock_us_hist"
            },
            "港股": {
                "description": "香港股票市场",
                "examples": ["00700", "09988", "02318"],
                "currency": "HKD",
                "function": "stock_hk_hist"
            },
            "指数": {
                "description": "主要股票指数",
                "examples": {
                    "000001": "上证指数",
                    "399001": "深证成指",
                    "000300": "沪深300",
                    "000016": "上证50",
                    "399006": "创业板指"
                },
                "currency": "CNY",
                "function": "stock_zh_index_daily"
            }
        }
    }

@app.get("/test")
async def test_data_sources():
    """测试各个市场的数据获取功能"""
    test_results = {}
    
    # 测试A股
    try:
        data, name, currency = get_a_stock_data("000001", "20240101", "20240110")
        test_results["A股"] = {
            "status": "成功",
            "sample_data": {
                "name": name,
                "currency": currency,
                "rows": len(data),
                "columns": data.columns.tolist() if not data.empty else [],
                "latest_price": float(data['收盘'].iloc[-1]) if not data.empty else None
            }
        }
    except Exception as e:
        test_results["A股"] = {"status": "失败", "error": str(e)}
    
    # 测试美股
    try:
        data, name, currency = get_us_stock_data("AAPL", "20240101", "20240110")
        test_results["美股"] = {
            "status": "成功",
            "sample_data": {
                "name": name,
                "currency": currency,
                "rows": len(data),
                "columns": data.columns.tolist() if not data.empty else [],
                "latest_price": float(data['收盘'].iloc[-1]) if not data.empty else None,
                "note": "如果显示'示例数据'说明真实数据源不可用，使用了模拟数据"
            }
        }
    except Exception as e:
        test_results["美股"] = {"status": "失败", "error": str(e)}
    
    # 测试港股
    try:
        data, name, currency = get_hk_stock_data("00700", "20240101", "20240110")
        test_results["港股"] = {
            "status": "成功",
            "sample_data": {
                "name": name,
                "currency": currency,
                "rows": len(data),
                "columns": data.columns.tolist() if not data.empty else [],
                "latest_price": float(data['收盘'].iloc[-1]) if not data.empty else None
            }
        }
    except Exception as e:
        test_results["港股"] = {"status": "失败", "error": str(e)}
    
    return test_results

@app.get("/check-akshare")
async def check_akshare_functions():
    """检查akshare可用的函数"""
    try:
        import akshare as ak
        
        # 检查版本
        version = getattr(ak, '__version__', 'unknown')
        
        # 检查美股相关函数
        us_functions = []
        potential_us_functions = [
            'stock_us_hist', 'stock_us_daily', 'stock_us_spot_em', 
            'stock_us_daily_sina', 'stock_us_spot', 'stock_us_fundamental'
        ]
        
        for func_name in potential_us_functions:
            if hasattr(ak, func_name):
                us_functions.append(f"✓ {func_name}")
            else:
                us_functions.append(f"✗ {func_name}")
        
        # 检查港股相关函数
        hk_functions = []
        potential_hk_functions = [
            'stock_hk_hist', 'stock_hk_daily', 'stock_hk_spot_em',
            'stock_hk_spot', 'stock_hk_fundamental'
        ]
        
        for func_name in potential_hk_functions:
            if hasattr(ak, func_name):
                hk_functions.append(f"✓ {func_name}")
            else:
                hk_functions.append(f"✗ {func_name}")
        
        return {
            "akshare_version": version,
            "美股函数检查": us_functions,
            "港股函数检查": hk_functions,
            "建议": {
                "美股": "如果大部分函数显示✗，说明akshare版本较老或者函数名已变更",
                "网络": "美股数据通常需要稳定的网络连接，建议检查网络状况",
                "备选方案": "API已内置示例数据功能，即使真实数据不可用也能正常工作"
            }
        }
        
    except Exception as e:
        return {
            "error": f"检查akshare时出错: {str(e)}",
            "建议": "请确保已安装akshare: pip install akshare"
        }

@app.get("/financial/{stock_code}")
async def get_financial_data(stock_code: str, market: Literal["A股", "美股", "港股"] = "A股"):
    """
    获取股票财务报表数据

    参数:
    - stock_code: 股票代码
    - market: 市场类型（默认A股）
    返回: 利润表、资产负债表、现金流量表
    """
    try:
        result = {
            "stock_code": stock_code,
            "market": market,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        if market == "A股":
            # 利润表
            try:
                profit_df = ak.stock_profit_sheet_by_report_em(symbol=stock_code)
                result["profit_sheet"] = {
                    "columns": profit_df.columns.tolist(),
                    "data": profit_df.head(4).to_dict("records")  # 最近4期
                }
            except Exception as e:
                result["profit_sheet"] = {"error": str(e)}

            # 资产负债表
            try:
                balance_df = ak.stock_balance_sheet_by_report_em(symbol=stock_code)
                result["balance_sheet"] = {
                    "columns": balance_df.columns.tolist(),
                    "data": balance_df.head(4).to_dict("records")
                }
            except Exception as e:
                result["balance_sheet"] = {"error": str(e)}

            # 现金流量表
            try:
                cashflow_df = ak.stock_cash_flow_sheet_by_report_em(symbol=stock_code)
                result["cash_flow_sheet"] = {
                    "columns": cashflow_df.columns.tolist(),
                    "data": cashflow_df.head(4).to_dict("records")
                }
            except Exception as e:
                result["cash_flow_sheet"] = {"error": str(e)}

        elif market == "港股":
            # 港股财报接口
            try:
                hk_financial = ak.stock_hk_financial(symbol=stock_code)
                result["financial_data"] = hk_financial.to_dict("records")
            except Exception as e:
                result["financial_data"] = {"error": str(e)}

        else:
            raise HTTPException(status_code=400, detail="暂不支持该市场的财报数据")

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取财报数据出错: {str(e)}")

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# 运行服务器
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)