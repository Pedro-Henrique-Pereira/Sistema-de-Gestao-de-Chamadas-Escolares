const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");

router.use(autenticar);
router.use(autorizar("administracao"));

router.get("/painel", adminController.painel);

module.exports = router;
