declare module 'qrcode-generator' {
	type TypeNumber = number; // 0 = auto-detect
	type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

	interface QRCode {
		addData(data: string): void;
		make(): void;
		getModuleCount(): number;
		isDark(row: number, col: number): boolean;
	}

	function qrcode(typeNumber: TypeNumber, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;
	export default qrcode;
}
