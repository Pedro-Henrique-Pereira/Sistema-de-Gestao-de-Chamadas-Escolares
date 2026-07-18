const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");

router.use(autenticar);
router.use(validarDatasRequest());
router.use(autorizar("administracao"));

router.get("/painel", adminController.painel);

module.exports = router;
