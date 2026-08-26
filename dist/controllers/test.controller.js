import { testService } from "@/services/test.service";
// Controllers handle req/res only — no business logic here.
export const testController = {
    getStatus(req, res) {
        const result = testService.getStatus();
        res.status(200).json(result);
    },
};
//# sourceMappingURL=test.controller.js.map