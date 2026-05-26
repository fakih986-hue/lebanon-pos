const code128Patterns = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
]

const startCodeB = 104
const stopCode = 106

function toCode128BValues(value: string) {
  return value.split("").map((character) => {
    const charCode = character.charCodeAt(0)

    if (charCode < 32 || charCode > 127) {
      throw new Error("Code 128 labels support standard ASCII characters only.")
    }

    return charCode - 32
  })
}

export function getCode128Patterns(value: string) {
  const cleanValue = value.trim()
  const values = toCode128BValues(cleanValue)
  const checksum =
    values.reduce((sum, code, index) => sum + code * (index + 1), startCodeB) %
    103

  return [
    code128Patterns[startCodeB],
    ...values.map((code) => code128Patterns[code]),
    code128Patterns[checksum],
    code128Patterns[stopCode],
  ]
}

export function renderCode128Svg(value: string, height = 64, moduleWidth = 2) {
  const patterns = getCode128Patterns(value)
  let x = 0
  const rects: string[] = []

  patterns.forEach((pattern) => {
    pattern.split("").forEach((widthValue, index) => {
      const width = Number(widthValue) * moduleWidth

      if (index % 2 === 0) {
        rects.push(
          `<rect x="${x}" y="0" width="${width}" height="${height}" />`
        )
      }

      x += width
    })
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" width="100%" height="${height}" preserveAspectRatio="none">${rects.join(
    ""
  )}</svg>`
}
