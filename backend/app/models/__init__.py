# Import all models here so Alembic can detect them
from app.models.user import User, RefreshToken  # noqa: F401
from app.models.material import Material  # noqa: F401
from app.models.disassembly import (  # noqa: F401
    DisassemblyTask,
    DisassemblyModule,
    ModuleDependency,
    SpecialistOutput,
    QuizData,
)
from app.models.course import CourseCategory, Course  # noqa: F401
