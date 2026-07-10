import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tapRouter from "./tap";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tapRouter);
router.use(accountRouter);

export default router;
