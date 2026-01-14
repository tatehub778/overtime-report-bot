import { kv } from '@vercel/kv';
import { parse } from 'csv-parse/sync';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { cboCsv, attendanceCsv, month } = req.body;

        if (!cboCsv || !attendanceCsv) {
            return res.status(400).json({ error: '両方のCSVファイルが必要です' });
        }

        // 1. 管理メンバー情報の取得
        const managementMembers = await getManagementMembers();

        // 2. データのパースと集計
        const cboData = parseCboCsv(cboCsv, managementMembers);
        const attendanceData = parseAttendanceCsv(attendanceCsv, managementMembers);

        // 3. データの結合
        const summary = combineData(cboData, attendanceData, managementMembers);

        return res.status(200).json({ summary });

    } catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({ error: '分析中にエラーが発生しました', details: error.message });
    }
}

// 管理メンバーの取得
async function getManagementMembers() {
    const members = new Map(); // Normalized Name -> Member Object

    try {
        const ids = await kv.smembers('employees:all');
        if (!ids) return members;

        for (const id of ids) {
            const data = await kv.get(`employee:${id}`);
            if (data && (data.department === 'management')) {
                // 名前を正規化してキーにする（スペース除去など）
                const normName = normalizeName(data.name);
                members.set(normName, {
                    ...data,
                    normName
                });
                // CBO名でも引けるようにする
                if (data.cboName) {
                    members.set(normalizeName(data.cboName), {
                        ...data,
                        normName
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to fetch members:', e);
    }
    return members;
}

// CBO CSV (現場時間・事務残業) のパース
function parseCboCsv(csvContent, members) {
    const records = parse(csvContent.trim(), {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true
    });

    const result = new Map(); // Name -> Stats

    for (const row of records) {
        // カラム名のマッピング（BOMや揺らぎに対応するため、indexでもアクセスできるようにしたいが、csv-parseのcolumns:trueなら名前で来る）
        // 想定ヘッダー: "作業日","報告者","案件名","...","作業時間合計","残業時間",..."作業内容","残業種別","早出時間",...

        const rawName = row['報告者'] || row['ユーザー名'] || '';
        const normName = normalizeName(rawName);

        // 管理メンバーでなければスキップ
        if (!members.has(normName)) continue;
        const member = members.get(normName);

        if (!result.has(member.id)) {
            result.set(member.id, {
                id: member.id,
                name: member.name,
                fieldWorkRegular: 0, // 定時内現場
                officeOvertime: 0,   // 事務残業
                details: []
            });
        }
        const stats = result.get(member.id);

        // セル内改行の処理
        // CBO CSVはセル内で改行されている場合、対応する値も改行で区切られていることが多い
        // 例: 案件A\n案件B, 時間A\n時間B
        // csv-parse はセル内の改行を保持して1つの文字列として返してくるので、ここでsplitする

        const projectNames = (row['案件名'] || '').split('\n');
        const totalHoursRaw = (row['作業時間合計'] || '').split('\n'); // これ、合計だから1行の可能性も？いや、案件ごとの可能性もある。要確認。
        // 確認したファイル(260114...csv)を見る限り:
        // "Total Hours" (Col 6) seem to be a single value for the day? e.g. "12.17"
        // But "Time Range" (Col 5) has multiple lines: "12:00～19:00\n20:30～03:00"
        // "Overtime" (Col 7) has multiple lines: "01:30\n06:30"
        // "Overtime Type" (Col 11) has multiple lines: "事務残業\n夜工事残業"

        // CBOのCSV仕様として、合計値は1つだが、内訳は改行されているパターンと、
        // そもそも行が分かれているパターンがあるかもしれない。
        // 今回のサンプル: Total Hours "12.17" is likely the sum of all activities on that day.

        // しかし、内訳計算（定時内現場）をするには、各ブロックごとの時間が必要。
        // Time Range ("12:00～19:00") から計算するのが確実。

        const timeRanges = (row['作業時間'] || '').split('\n'); // "12:00～19:00"
        const contentTypes = (row['作業内容'] || '').split('\n');
        const overtimeTypes = (row['残業種別'] || '').split('\n');
        const overtimes = (row['残業時間'] || '').split('\n');
        const earlies = (row['早出時間'] || '').split('\n');

        // 最大の行数を取得
        const maxLines = Math.max(timeRanges.length, contentTypes.length, overtimeTypes.length);

        for (let i = 0; i < maxLines; i++) {
            const range = timeRanges[i] || '';
            const content = contentTypes[i] || '';
            const otType = overtimeTypes[i] || '';
            const otStr = overtimes[i] || '0:00';
            const earlyStr = earlies[i] || '0:00';

            // 時間計算
            const totalDuration = calculateDuration(range); // 時間帯から算出
            const otHours = parseTimeStr(otStr);
            const earlyHours = parseTimeStr(earlyStr);

            // 定時内作業時間 = 総拘束時間 - 残業 - 早出
            // ※休憩時間が引かれていない可能性があるが、CBOの仕様上、"作業時間合計"に入っている値との整合性が不明。
            // いったん (EndTime - StartTime) - OT - Early で計算する。
            let regularHours = Math.max(0, totalDuration - otHours - earlyHours);

            // 休憩(1h)の考慮
            // 通常、8:00-17:30 (9.5h) のうち、8h労働なので1.5h休憩？
            // 簡易的に、6時間超えなら1時間引く等のロジックを入れるか、
            // あるいは「定時内」の定義を単純に「残業以外の作業時間」とする。

            // ここでは、「事務残業」とマークされていない、かつ「事務っぽい作業内容」でないものを「現場仕事」とする。

            const isOfficeOvertime = otType.includes('事務残業');
            const isOfficeContent = /事務|見積|作図|打合せ|会議|移動/.test(content);
            const isFieldContent = /現場|工事|作業|立会|搬入/.test(content);

            // 分類
            if (isOfficeOvertime) {
                stats.officeOvertime += otHours + earlyHours;

                // 詳細リストに追加 (事務残業のみ)
                stats.details.push({
                    date: row['作業日'] || '',
                    project: (projectNames[i] || projectNames[0] || '').trim(), // 行対応がなければ先頭を使う
                    task: content,
                    hours: otHours + earlyHours
                });
            }

            // 定時内分の判定
            if (regularHours > 0) {
                if (isFieldContent || (!isOfficeContent)) {
                    // 明示的に現場、または事務っぽくないもの
                    stats.fieldWorkRegular += regularHours;
                }
                // 事務っぽいものはカウントしない（Userの要望は「定時内にどれぐらい現場に行っているのか」）
            }
        }
    }
    return result;
}

// 出勤簿 CSV (残業合計) のパース
function parseAttendanceCsv(csvContent, members) {
    // こちらはShift-JISなどで読み込まれた文字列が来る前提（フロントでdecode済み推奨だが、APIに来るのはstring）
    // フォーマット: 日付,曜日,報告者,開始時刻,終了時刻,作業(h)_所定,作業(h)_時間外,残業(h),...

    // csv-parseを使う
    const records = parse(csvContent.trim(), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
    });

    const result = new Map(); // Name -> Total Overtime

    for (const row of records) {
        const rawName = row['報告者'] || '';
        const normName = normalizeName(rawName);

        if (!members.has(normName)) continue;
        const member = members.get(normName);

        // 残業(h) カラムを使用
        const totalOt = parseFloat(row['残業(h)'] || 0);

        if (!isNaN(totalOt)) {
            const current = result.get(member.id) || 0;
            result.set(member.id, current + totalOt);
        }
    }
    return result;
}

// データ結合
function combineData(cboData, attendanceData, members) {
    const combined = [];

    // 全管理メンバーについて生成（データがなくても表示）
    const seenIds = new Set();

    // 1. CBOデータから
    cboData.forEach((stats, id) => {
        seenIds.add(id);
        const totalOvertime = attendanceData.get(id) || 0;

        // 事務残業以外の残業 = (出勤簿の残業合計) - (CBOの事務残業)
        // ※ただしマイナスにならないように
        let otherOvertime = Math.max(0, totalOvertime - stats.officeOvertime);

        combined.push({
            name: stats.name,
            fieldWorkRegular: parseFloat(stats.fieldWorkRegular.toFixed(2)),
            officeOvertime: parseFloat(stats.officeOvertime.toFixed(2)),
            totalOvertime: parseFloat(totalOvertime.toFixed(2)),
            otherOvertime: parseFloat(otherOvertime.toFixed(2)),
            details: stats.details || []
        });
    });

    // 2. データがなかったメンバーも追加
    members.forEach((m) => {
        if (!seenIds.has(m.id)) {
            // 重複チェック (Mapの値はMember Object)
            // membersはName->Objなので、IDで重複排除済みならOKだが、
            // normNameが異なってもIDが同じ場合がありうる？ いや、IDはユニーク。
            if ([...seenIds].includes(m.id)) return;
            seenIds.add(m.id);

            combined.push({
                name: m.name,
                fieldWorkRegular: 0,
                officeOvertime: 0,
                totalOvertime: 0, // Attendanceにだけある場合もあるかも
                otherOvertime: 0
            });
        }
    });

    // Attendanceのみにあったパターンの補完が必要ならここで行う

    return combined;
}

// ユーティリティ: 名前正規化
function normalizeName(name) {
    return name.replace(/\d+/g, '').replace(/[\s　]+/g, '').trim();
}

// ユーティリティ: 時間パース (HH:MM -> Hours)
function parseTimeStr(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h)) return 0;
    return h + (m || 0) / 60;
}

// ユーティリティ: 期間計算 (HH:MM～HH:MM -> Hours)
function calculateDuration(rangeStr) {
    if (!rangeStr || !rangeStr.includes('～')) return 0;
    const [start, end] = rangeStr.split('～');

    let startH = parseTimeStr(start);
    let endH = parseTimeStr(end);

    // 日またぎ対応 (例えば 20:00～03:00)
    if (endH < startH) {
        endH += 24;
    }

    return endH - startH;
}
